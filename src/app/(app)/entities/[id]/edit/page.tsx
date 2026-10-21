import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EntityForm } from "../../entity-form";
import { updateEntity } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditEntityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const e = await db.entity.findUnique({ where: { id } });
  if (!e) notFound();
  return (
    <div className="grid gap-6">
      <PageHeader title={`Edit ${e.name}`} />
      <EntityForm action={updateEntity.bind(null, id)} initial={e} submitLabel="Save changes" />
    </div>
  );
}
