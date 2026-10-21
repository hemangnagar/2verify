import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EntityForm } from "../entity-form";
import { createEntity } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEntityPage() {
  await requireAdmin();
  return (
    <div className="grid gap-6">
      <PageHeader title="Add location" />
      <EntityForm action={createEntity} />
    </div>
  );
}
