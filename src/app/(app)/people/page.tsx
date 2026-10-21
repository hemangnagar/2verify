import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const people = await db.person.findMany({
    where: all ? {} : { active: true },
    include: { entity: true, credentials: { include: { credentialType: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const types = await db.credentialType.findMany({ where: { category: "training" } });
  return (
    <div className="grid gap-6">
      <PageHeader
        title="People"
        description={`${people.length} ${all ? "total" : "active"}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={all ? "/people" : "/people?all=1"}>{all ? "Active only" : "Include inactive"}</Link>
            </Button>
            <Button asChild>
              <Link href="/people/new">Add person</Link>
            </Button>
          </>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>NPI</TableHead>
            <TableHead>Credentials</TableHead>
            <TableHead>Attention</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((p) => {
            const bad = p.credentials.filter((c) => c.status === "expired" || c.status === "expiring" || c.status === "suspended").length;
            const missing = types.filter((t) => t.requiredForRoles.includes(p.role) && !p.credentials.some((c) => c.credentialTypeId === t.id));
            return (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/people/${p.id}`} className="font-medium hover:underline">
                    {p.lastName}, {p.firstName}
                  </Link>
                  {!p.active && <Badge variant="secondary" className="ml-2">inactive</Badge>}
                </TableCell>
                <TableCell>{p.role}</TableCell>
                <TableCell className="text-muted-foreground">{p.entity?.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{p.npi ?? "—"}</TableCell>
                <TableCell>{p.credentials.length}</TableCell>
                <TableCell className="space-x-1">
                  {bad > 0 && <Badge variant="warning">{bad} expiring/expired</Badge>}
                  {missing.length > 0 && <Badge variant="destructive">missing {missing.map((m) => m.name.split(" ")[0]).join(", ")}</Badge>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
