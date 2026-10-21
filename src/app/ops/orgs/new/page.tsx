import { asSystem, db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { OrgForm } from "./org-form";

export const dynamic = "force-dynamic";

export default async function NewOrgPage() {
  const plans = await asSystem(() => db.plan.findMany({ orderBy: { sortOrder: "asc" } }));
  return (
    <div className="grid gap-6">
      <PageHeader title="New customer" description="Creates the organization, posts its annual credit allotment, and emails the first admin an invite." />
      <OrgForm plans={plans} />
    </div>
  );
}
