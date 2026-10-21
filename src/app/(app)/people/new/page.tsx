import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { PersonForm } from "../person-form";
import { createPerson } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPersonPage() {
  const entities = await db.entity.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="grid gap-6">
      <PageHeader title="Add person" />
      <PersonForm action={createPerson} entities={entities} />
    </div>
  );
}
