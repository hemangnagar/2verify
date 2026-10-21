import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { updateCredentialType } from "../actions";

export const dynamic = "force-dynamic";

export default async function CredentialTypesPage() {
  await requireAdmin();
  const types = await db.credentialType.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], include: { _count: { select: { credentials: true } } } });
  return (
    <div className="grid gap-6">
      <PageHeader title="Credential types" description="Defaults apply to new credentials; existing ones keep their own lead and re-verify days." />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Lead days</TableHead>
            <TableHead>Re-verify days</TableHead>
            <TableHead>PSV</TableHead>
            <TableHead>Required for roles</TableHead>
            <TableHead>In use</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell>{t.category}</TableCell>
              <TableCell colSpan={5}>
                <form action={updateCredentialType.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
                  <Input name="defaultLeadDays" type="number" min={0} defaultValue={t.defaultLeadDays} className="w-20" />
                  <Input name="defaultReverifyDays" type="number" min={1} defaultValue={t.defaultReverifyDays} className="w-20" />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="psvRequired" defaultChecked={t.psvRequired} /> PSV
                  </label>
                  {t.category === "training" && (
                    <span className="flex flex-wrap gap-2 text-xs">
                      {["pharmacist", "technician", "intern", "prescriber", "staff"].map((r) => (
                        <label key={r} className="flex items-center gap-1">
                          <input type="checkbox" name="requiredForRoles[]" value={r} defaultChecked={t.requiredForRoles.includes(r as never)} /> {r}
                        </label>
                      ))}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{t._count.credentials} credentials</span>
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
