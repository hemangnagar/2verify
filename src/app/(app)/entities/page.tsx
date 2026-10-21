import Link from "next/link";
import { db } from "@/lib/db";
import { getSession, isOrgAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  const session = await getSession();
  const entities = await db.entity.findMany({ include: { _count: { select: { people: true, credentials: true } } }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] });
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Locations"
        actions={
          (session ? isOrgAdmin(session) : false) && (
            <Button asChild>
              <Link href="/entities/new">Add location</Link>
            </Button>
          )
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>State</TableHead>
            <TableHead>NPI</TableHead>
            <TableHead>DEA</TableHead>
            <TableHead>People</TableHead>
            <TableHead>Entity credentials</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entities.map((e) => (
            <TableRow key={e.id}>
              <TableCell>
                <Link href={`/entities/${e.id}`} className="font-medium hover:underline">
                  {e.name}
                </Link>
                {e.isPrimary && <Badge variant="secondary" className="ml-2">primary</Badge>}
              </TableCell>
              <TableCell>{e.state}</TableCell>
              <TableCell className="font-mono text-xs">{e.npi ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{e.deaNumber ?? "—"}</TableCell>
              <TableCell>{e._count.people}</TableCell>
              <TableCell>{e._count.credentials}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
