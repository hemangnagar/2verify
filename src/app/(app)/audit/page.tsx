import { db } from "@/lib/db";
import { requireOrgAdmin } from "@/lib/auth";
import { changedFields } from "@/lib/audit-format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const TABLES = ["Entity", "Person", "Credential", "CredentialType", "BoardLookup", "Verification", "ScreeningRun", "ScreeningMatch", "Alert", "User"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOrgAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 100;
  const where = {
    ...(sp.table ? { table: sp.table } : {}),
    ...(sp.row ? { rowId: sp.row } : {}),
    ...(sp.user ? { user: { email: { contains: sp.user, mode: "insensitive" as const } } } : {}),
    ...(sp.from ? { at: { gte: new Date(sp.from) } } : {}),
  };
  const [rows, total, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: "desc" }, include: { user: true }, skip: (page - 1) * take, take }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { email: true } }),
  ]);
  const qs = (p: number) => "?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => !!e[1])), page: String(p) }).toString();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description={`${total} entries · insert-only, every change to every row`}
        actions={
          <Button asChild variant="outline">
            <a href="/api/reports/csv?kind=audit">Export CSV</a>
          </Button>
        }
      />
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
        <Select name="table" defaultValue={sp.table ?? ""} className="w-44">
          <option value="">All tables</option>
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select name="user" defaultValue={sp.user ?? ""} className="w-56">
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.email} value={u.email}>
              {u.email}
            </option>
          ))}
        </Select>
        <Input name="row" placeholder="Row id" defaultValue={sp.row ?? ""} className="w-64" />
        <Input name="from" type="date" defaultValue={sp.from ?? ""} />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        <Button asChild variant="ghost">
          <a href="/audit">Clear</a>
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (UTC)</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>Row</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="text-xs">{a.at.toISOString().replace("T", " ").slice(0, 19)}</TableCell>
              <TableCell className="text-xs">{a.user?.email ?? "system"}</TableCell>
              <TableCell>{a.table}</TableCell>
              <TableCell className="font-mono text-xs">{a.rowId.slice(0, 12)}…</TableCell>
              <TableCell>{a.action}</TableCell>
              <TableCell className="max-w-xl whitespace-normal text-xs text-muted-foreground">{changedFields(a.before, a.after)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2 text-sm">
        {page > 1 && (
          <Button asChild variant="outline" size="sm">
            <a href={qs(page - 1)}>Newer</a>
          </Button>
        )}
        <span className="text-muted-foreground">
          page {page} of {Math.max(1, Math.ceil(total / take))}
        </span>
        {page * take < total && (
          <Button asChild variant="outline" size="sm">
            <a href={qs(page + 1)}>Older</a>
          </Button>
        )}
      </div>
    </div>
  );
}
