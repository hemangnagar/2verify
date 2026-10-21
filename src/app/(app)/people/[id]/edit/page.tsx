import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { PersonForm } from "../../person-form";
import { updatePerson } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, entities] = await Promise.all([db.person.findUnique({ where: { id } }), db.entity.findMany({ orderBy: { name: "asc" } })]);
  if (!p) notFound();
  return (
    <div className="grid gap-6">
      <PageHeader title={`Edit ${p.firstName} ${p.lastName}`} />
      <PersonForm
        action={updatePerson.bind(null, id)}
        entities={entities}
        initial={{ ...p, dob: p.dob ? isoDate(p.dob) : "", hireDate: p.hireDate ? isoDate(p.hireDate) : "" }}
        submitLabel="Save changes"
      />
    </div>
  );
}
