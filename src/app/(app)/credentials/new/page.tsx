import { formOptions } from "@/lib/credentials";
import { PageHeader } from "@/components/page-header";
import { CredentialForm } from "../credential-form";
import { createCredential } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCredentialPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const opts = await formOptions();
  return (
    <div className="grid gap-6">
      <PageHeader title="Add credential" />
      <CredentialForm action={createCredential} {...opts} initial={{ subjectType: sp.entity ? "entity" : "person", personId: sp.person ?? null, entityId: sp.entity ?? null }} />
    </div>
  );
}
