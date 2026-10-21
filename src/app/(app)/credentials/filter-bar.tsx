import type { CredentialType, Entity, Person } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

/** Plain GET form: filters live in the URL so they are shareable and the page stays a server component. */
export function CredentialFilterBar({
  current,
  types,
  people,
  entities,
  states,
  showBucket = true,
}: {
  current: Record<string, string | undefined>;
  types: CredentialType[];
  people: Person[];
  entities: Entity[];
  states: string[];
  showBucket?: boolean;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
      {current.tab && <input type="hidden" name="tab" value={current.tab} />}
      <Input name="q" placeholder="Search name, type, number" defaultValue={current.q ?? ""} className="w-56" />
      <Select name="entity" defaultValue={current.entity ?? ""} className="w-48">
        <option value="">All locations</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
      <Select name="person" defaultValue={current.person ?? ""} className="w-48">
        <option value="">All people</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.lastName}, {p.firstName}
          </option>
        ))}
      </Select>
      <Select name="type" defaultValue={current.type ?? ""} className="w-52">
        <option value="">All types</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <Select name="state" defaultValue={current.state ?? ""} className="w-24">
        <option value="">State</option>
        {states.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Select name="status" defaultValue={current.status ?? ""} className="w-32">
        <option value="">Any status</option>
        {["active", "expiring", "expired", "suspended", "unknown"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      {showBucket && (
        <Select name="bucket" defaultValue={current.bucket ?? ""} className="w-40">
          <option value="">Any bucket</option>
          <option value="expiring30">Expiring ≤ 30d</option>
          <option value="expiring90">Expiring ≤ 90d</option>
          <option value="overdue">Overdue</option>
          <option value="neverVerified">Never verified</option>
          <option value="verifyDue">Verification due</option>
        </Select>
      )}
      <Button type="submit" variant="secondary">
        Filter
      </Button>
      <Button asChild variant="ghost">
        <a href="?">Clear</a>
      </Button>
    </form>
  );
}
