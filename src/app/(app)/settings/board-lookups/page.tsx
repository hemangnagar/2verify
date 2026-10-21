import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteBoardLookup, upsertBoardLookup } from "../actions";
import { US_STATES } from "@/lib/credentials";

export const dynamic = "force-dynamic";

export default async function BoardLookupsPage() {
  await requireAdmin();
  const [lookups, types] = await Promise.all([
    db.boardLookup.findMany({ include: { credentialType: true }, orderBy: [{ state: "asc" }, { credentialType: { name: "asc" } }] }),
    db.credentialType.findMany({ where: { psvRequired: true, stateSpecific: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="grid gap-6">
      <PageHeader title="Board lookups" description="URL templates may use {number}, {last_name}, {first_name}. Notes are shown to the verifier under the link." />
      <Card>
        <CardHeader>
          <CardTitle>Add or replace</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={upsertBoardLookup} className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
            <Select name="state" defaultValue="NV">
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select name="credentialTypeId">
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Input name="boardName" placeholder="Board name" required />
            <Input name="urlTemplate" placeholder="https://…?license={number}" className="sm:col-span-3" required />
            <Textarea name="notes" placeholder="What the board page shows and where" className="sm:col-span-3" />
            <div>
              <Button type="submit">Save lookup</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {lookups.map((l) => (
          <Card key={l.id}>
            <CardContent className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">
                  {l.state} · {l.credentialType.name}
                </span>
                <span className="text-muted-foreground">{l.boardName}</span>
                <form action={deleteBoardLookup.bind(null, l.id)} className="ml-auto">
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </form>
              </div>
              <a href={l.urlTemplate} target="_blank" rel="noreferrer" className="truncate text-xs underline">
                {l.urlTemplate}
              </a>
              <p className="text-xs text-muted-foreground">{l.notes}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
