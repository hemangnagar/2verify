import { Prisma, PrismaClient, type UserRole } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is making the current mutation. Server actions wrap their work in
 * `auditContext.run({ userId }, …)`; jobs and seeds leave it unset (userId = null = system).
 */
export const auditContext = new AsyncLocalStorage<{ userId: string | null }>();

/**
 * Which organization the current work is scoped to.
 *  - Server actions set it from the session (`withUser`).
 *  - Pages and route handlers do not set it; the client derives it from the session cookie.
 *  - Jobs and seeds set it explicitly per org with role "system".
 * Operators (and system) with orgId = null run unscoped. Anyone else with no org is refused.
 */
export interface OrgScope {
  orgId: string | null;
  role: UserRole | "system" | "none";
}
export const orgContext = new AsyncLocalStorage<OrgScope>();

/** Models that carry org_id and are filtered by it. User and AuditLog have nullable org_id; see below. */
const SCOPED = new Set(["Entity", "Person", "Credential", "Verification", "ScreeningRun", "ScreeningMatch", "Alert", "CreditLedger", "AuditLog"]);
/** Scoped on reads only when an org is in scope; writes get org_id when present but never throw for null. */
const NULLABLE_ORG = new Set(["AuditLog"]);
const UNAUDITED = new Set(["AuditLog"]);

const SNAPSHOT_FIELD_LIMIT = 8_000;

function snapshot(row: unknown): unknown {
  if (row === null || row === undefined) return null;
  const s = JSON.stringify(row);
  return s.length > SNAPSHOT_FIELD_LIMIT ? { _truncated: true, preview: s.slice(0, SNAPSHOT_FIELD_LIMIT) } : JSON.parse(s);
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// Relation map from the generated DMMF so nested writes on scoped models also get org_id.
const RELATIONS = new Map<string, Map<string, string>>();
for (const m of Prisma.dmmf.datamodel.models) {
  RELATIONS.set(m.name, new Map(m.fields.filter((f) => f.kind === "object").map((f) => [f.name, f.type])));
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

let authModule: Promise<{ getSession: () => Promise<{ role: UserRole; orgId: string | null; activeOrgId: string | null } | null> } | null> | null = null;

async function resolveScope(): Promise<OrgScope> {
  const store = orgContext.getStore();
  if (store) return store;
  // Request scope (pages, route handlers): derive from the session cookie. Outside Next (jobs,
  // tests) the auth module refuses to load and we fall through to "none".
  authModule ??= import("./auth").then((m) => m as never).catch(() => null);
  const auth = await authModule;
  if (auth) {
    try {
      const s = await auth.getSession();
      if (s) return { orgId: s.activeOrgId ?? s.orgId, role: s.role };
    } catch {
      /* not in a request */
    }
  }
  return { orgId: null, role: "none" };
}

export class OrgScopeError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "OrgScopeError";
  }
}

function assertScope(scope: OrgScope, model: string): string | null {
  if (scope.orgId) return scope.orgId;
  if (scope.role === "operator" || scope.role === "system") return null; // unscoped
  if (NULLABLE_ORG.has(model)) return null;
  throw new OrgScopeError(`No organization in scope for ${model} (role ${scope.role})`);
}

function injectData(model: string, data: Record<string, unknown>, orgId: string) {
  if (SCOPED.has(model)) {
    if (data.orgId && data.orgId !== orgId) throw new OrgScopeError(`Write to another organization refused (${model})`);
    if (data.org && typeof data.org === "object") {
      const connectId = (data.org as { connect?: { id?: string } }).connect?.id;
      if (connectId && connectId !== orgId) throw new OrgScopeError(`Write to another organization refused (${model})`);
    } else if (!data.orgId) data.orgId = orgId;
  }
  // Nested writes: credential.create({ data: { verifications: { create: {...} } } }) etc.
  const rels = RELATIONS.get(model);
  if (!rels) return;
  for (const [field, target] of rels) {
    const v = data[field] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object" || !SCOPED.has(target)) continue;
    for (const op of ["create", "connectOrCreate"] as const) {
      const nested = v[op];
      if (!nested) continue;
      const items = Array.isArray(nested) ? nested : [nested];
      for (const item of items) {
        const payload = op === "connectOrCreate" ? (item as { create: Record<string, unknown> }).create : (item as Record<string, unknown>);
        if (payload) injectData(target, payload, orgId);
      }
    }
    if (v.createMany && typeof v.createMany === "object") {
      const cm = v.createMany as { data: Record<string, unknown> | Record<string, unknown>[] };
      for (const item of Array.isArray(cm.data) ? cm.data : [cm.data]) injectData(target, item, orgId);
    }
  }
}

function scopedWhere(where: Record<string, unknown> | undefined, orgId: string, unique: boolean) {
  const w = where ?? {};
  if (w.orgId && w.orgId !== orgId) throw new OrgScopeError("Read from another organization refused");
  return unique ? { ...w, orgId } : { AND: [w, { orgId }] };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type AnyDelegate = {
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
};

/**
 * Prisma client with two extensions:
 *  - org scoping: every read on a scoped model is filtered to the org in scope, every write
 *    carries it, and a write that names another org throws.
 *  - audit: every create/update/delete (single or many) on every model writes an audit_log row
 *    with before/after snapshots, the acting user, and the org.
 *
 * The audit row is written with the base client, so inside an interactive transaction it commits
 * independently: a rolled-back change still leaves an audit row recording the attempt.
 */
function createClient() {
  const base = new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });
  const delegate = (model: string): AnyDelegate => (base as unknown as Record<string, AnyDelegate>)[lowerFirst(model)];

  async function audit(table: string, rowId: string, action: "create" | "update" | "delete", before: unknown, after: unknown, orgId: string | null) {
    const userId = auditContext.getStore()?.userId ?? null;
    await base.auditLog.create({ data: { table, rowId, action, userId, orgId, before: snapshot(before) ?? undefined, after: snapshot(after) ?? undefined } });
  }
  const rowOrg = (row: unknown, scopeOrg: string | null) => ((row as { orgId?: string } | null)?.orgId ?? scopeOrg) ?? null;

  const READ_OPS = ["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"] as const;
  const UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

  const scoped = base.$extends({
    name: "org-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SCOPED.has(model)) return query(args);
          const scope = await resolveScope();
          const orgId = assertScope(scope, model);
          if (!orgId) return query(args); // operator / system, unscoped
          const a = args as Record<string, unknown>;
          if ((READ_OPS as readonly string[]).includes(operation) || operation === "updateMany" || operation === "deleteMany" || operation === "update" || operation === "delete" || operation === "upsert") {
            a.where = scopedWhere(a.where as Record<string, unknown> | undefined, orgId, UNIQUE_OPS.has(operation));
          }
          if (operation === "create" || operation === "update" || operation === "upsert") {
            if (operation === "upsert") {
              injectData(model, a.create as Record<string, unknown>, orgId);
              injectData(model, a.update as Record<string, unknown>, orgId);
            } else injectData(model, a.data as Record<string, unknown>, orgId);
          }
          if (operation === "createMany" || operation === "createManyAndReturn") {
            const d = a.data as Record<string, unknown> | Record<string, unknown>[];
            for (const row of Array.isArray(d) ? d : [d]) injectData(model, row, orgId);
          }
          return query(args);
        },
      },
    },
  });

  const db = scoped.$extends({
    name: "audit",
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), "create", null, result, rowOrg(result, (await resolveScope()).orgId));
          return result;
        },
        async createMany({ model, args, query }) {
          const result = await query(args);
          if (!UNAUDITED.has(model)) await audit(model, "*", "create", null, { count: (result as { count: number }).count, data: args.data }, (await resolveScope()).orgId);
          return result;
        },
        async update({ model, args, query }) {
          const before = UNAUDITED.has(model) ? null : await delegate(model).findUnique({ where: args.where });
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), "update", before, result, rowOrg(result, (await resolveScope()).orgId));
          return result;
        },
        async upsert({ model, args, query }) {
          const before = UNAUDITED.has(model) ? null : await delegate(model).findUnique({ where: args.where });
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), before ? "update" : "create", before, result, rowOrg(result, (await resolveScope()).orgId));
          return result;
        },
        async delete({ model, args, query }) {
          const before = UNAUDITED.has(model) ? null : await delegate(model).findUnique({ where: args.where });
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), "delete", before, null, rowOrg(before, (await resolveScope()).orgId));
          return result;
        },
        async updateMany({ model, args, query }) {
          const befores = UNAUDITED.has(model) ? [] : await delegate(model).findMany({ where: args.where });
          const result = await query(args);
          if (!UNAUDITED.has(model) && befores.length) {
            const afters = await delegate(model).findMany({ where: { id: { in: befores.map((b) => b.id) } } });
            const byId = new Map(afters.map((a) => [a.id as string, a]));
            for (const b of befores) await audit(model, String(b.id), "update", b, byId.get(b.id as string) ?? null, rowOrg(b, null));
          }
          return result;
        },
        async deleteMany({ model, args, query }) {
          const befores = UNAUDITED.has(model) ? [] : await delegate(model).findMany({ where: args.where });
          const result = await query(args);
          if (!UNAUDITED.has(model)) for (const b of befores) await audit(model, String(b.id), "delete", b, null, rowOrg(b, null));
          return result;
        },
      },
    },
  });
  return { db, base };
}

export type Db = ReturnType<typeof createClient>["db"];

const globalForPrisma = globalThis as unknown as { prisma?: Db; prismaBase?: PrismaClient };

const created = globalForPrisma.prisma && globalForPrisma.prismaBase ? { db: globalForPrisma.prisma, base: globalForPrisma.prismaBase } : createClient();

/** Scoped + audited client. Use this everywhere in the app. */
export const db: Db = created.db;
/** Unextended client: only for the seed wipe, migrations-era scripts, and tests that check isolation. */
export const dbRaw: PrismaClient = created.base;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaBase = dbRaw;
}

/** The org in scope for the current server action, job, or seed step. Throws outside one. */
export function currentOrgId(): string {
  const id = orgContext.getStore()?.orgId;
  if (!id) throw new OrgScopeError("No organization in scope");
  return id;
}

/**
 * Run `fn` scoped to one org as the system (jobs, seeds).
 * Prisma queries execute lazily when awaited, so the await happens inside the context on purpose.
 */
export function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return orgContext.run({ orgId, role: "system" }, async () => {
    return await fn();
  });
}

/** Run `fn` unscoped as the system (jobs listing orgs, seeds creating orgs). */
export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return orgContext.run({ orgId: null, role: "system" }, async () => {
    return await fn();
  });
}

/** Run `fn` under an explicit scope (tests, operator tooling). Awaits inside the context. */
export function withScope<T>(scope: OrgScope, fn: () => Promise<T>): Promise<T> {
  return orgContext.run(scope, async () => {
    return await fn();
  });
}
