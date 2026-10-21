import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is making the current mutation. Server actions wrap their work in
 * `auditContext.run({ userId }, ...)`; jobs and seeds leave it unset (userId = null = system).
 */
export const auditContext = new AsyncLocalStorage<{ userId: string | null }>();

/** Models whose own writes are not audited (the audit log itself). */
const UNAUDITED = new Set(["AuditLog"]);

const SNAPSHOT_FIELD_LIMIT = 8_000; // chars; large JSON (rosters, source records) is truncated in the audit snapshot

function snapshot(row: unknown): unknown {
  if (row === null || row === undefined) return null;
  const s = JSON.stringify(row);
  return s.length > SNAPSHOT_FIELD_LIMIT ? { _truncated: true, preview: s.slice(0, SNAPSHOT_FIELD_LIMIT) } : JSON.parse(s);
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

type AnyDelegate = {
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
};

/**
 * Prisma client with an audit extension: every create/update/delete (single or many) on every
 * model writes an audit_log row with before/after snapshots and the acting user.
 *
 * Known limitation: the audit row is written with the base client, so inside an interactive
 * transaction it commits independently. If the surrounding transaction rolls back, the audit row
 * remains and records an attempted change. Acceptable for this system; noted in the README.
 */
function createClient() {
  const base = new PrismaClient({
    log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"],
  });

  const delegate = (model: string): AnyDelegate => (base as unknown as Record<string, AnyDelegate>)[lowerFirst(model)];

  async function audit(table: string, rowId: string, action: "create" | "update" | "delete", before: unknown, after: unknown) {
    const userId = auditContext.getStore()?.userId ?? null;
    await base.auditLog.create({
      data: { table, rowId, action, userId, before: snapshot(before) ?? undefined, after: snapshot(after) ?? undefined },
    });
  }

  const db = base.$extends({
    name: "audit",
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), "create", null, result);
          return result;
        },
        async createMany({ model, args, query }) {
          // createMany returns only a count; audit each row by re-reading is not possible without ids.
          // Callers that need per-row audit use create() in a loop (the seed does).
          const result = await query(args);
          if (!UNAUDITED.has(model)) await audit(model, "*", "create", null, { count: (result as { count: number }).count, data: args.data });
          return result;
        },
        async update({ model, args, query }) {
          const before = UNAUDITED.has(model) ? null : await delegate(model).findUnique({ where: args.where });
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), "update", before, result);
          return result;
        },
        async upsert({ model, args, query }) {
          const before = UNAUDITED.has(model) ? null : await delegate(model).findUnique({ where: args.where });
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), before ? "update" : "create", before, result);
          return result;
        },
        async delete({ model, args, query }) {
          const before = UNAUDITED.has(model) ? null : await delegate(model).findUnique({ where: args.where });
          const result = (await query(args)) as Record<string, unknown>;
          if (!UNAUDITED.has(model)) await audit(model, String(result.id), "delete", before, null);
          return result;
        },
        async updateMany({ model, args, query }) {
          const befores = UNAUDITED.has(model) ? [] : await delegate(model).findMany({ where: args.where });
          const result = await query(args);
          if (!UNAUDITED.has(model) && befores.length) {
            const afters = await delegate(model).findMany({ where: { id: { in: befores.map((b) => b.id) } } });
            const byId = new Map(afters.map((a) => [a.id as string, a]));
            for (const b of befores) await audit(model, String(b.id), "update", b, byId.get(b.id as string) ?? null);
          }
          return result;
        },
        async deleteMany({ model, args, query }) {
          const befores = UNAUDITED.has(model) ? [] : await delegate(model).findMany({ where: args.where });
          const result = await query(args);
          if (!UNAUDITED.has(model)) for (const b of befores) await audit(model, String(b.id), "delete", b, null);
          return result;
        },
      },
    },
  });
  return { db, base };
}

export type Db = ReturnType<typeof createClient>["db"];

const globalForPrisma = globalThis as unknown as { prisma?: Db; prismaBase?: PrismaClient };

const created = globalForPrisma.prisma && globalForPrisma.prismaBase
  ? { db: globalForPrisma.prisma, base: globalForPrisma.prismaBase }
  : createClient();

/** Audited client. Use this everywhere in the app. */
export const db: Db = created.db;
/** Unextended client: only for the seed wipe (deletes insert-only rows under app.allow_wipe) and raw SQL. */
export const dbRaw: PrismaClient = created.base;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaBase = dbRaw;
}
