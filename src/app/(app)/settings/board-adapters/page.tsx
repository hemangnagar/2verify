import { db } from "@/lib/db";
import { requireOrgAdmin } from "@/lib/auth";
import { ADAPTERS, adaptersEnabled } from "@/lib/boards";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { brand } from "@/config/brand";

export const dynamic = "force-dynamic";

/** Read-only for customers: which boards are automated. Enabling and adding adapters is 2Verify engineering work. */
export default async function BoardAdaptersPage() {
  await requireOrgAdmin();
  const rows = await db.boardAdapter.findMany({ include: { credentialType: true }, orderBy: [{ state: "asc" }] });
  return (
    <div className="grid gap-6">
      <PageHeader title="Automated boards" description={`Boards ${brand.name} queries directly. Every other state and license type goes through the guided workbench. New boards are added by ${brand.name} per state, where the board's site and terms allow it.`} />
      {!adaptersEnabled() && <p className="text-sm text-amber-700">Automation is switched off on this instance (BOARD_ADAPTERS=off).</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>State</TableHead>
            <TableHead>Credential type</TableHead>
            <TableHead>Board</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rate limit</TableHead>
            <TableHead>Last success</TableHead>
            <TableHead>Last error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.state}</TableCell>
              <TableCell>{r.credentialType.name}</TableCell>
              <TableCell>{ADAPTERS[r.adapter]?.board ?? r.adapter}</TableCell>
              <TableCell>{r.enabled && ADAPTERS[r.adapter] ? <Badge variant="success">enabled</Badge> : <Badge variant="secondary">disabled</Badge>}</TableCell>
              <TableCell>1 query / {r.minIntervalSec}s</TableCell>
              <TableCell className="text-xs">{r.lastSuccessAt ? r.lastSuccessAt.toISOString().replace("T", " ").slice(0, 16) : "—"}</TableCell>
              <TableCell className="max-w-sm whitespace-normal text-xs text-destructive">{r.lastError ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
