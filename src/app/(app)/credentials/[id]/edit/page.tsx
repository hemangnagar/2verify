import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formOptions } from "@/lib/credentials";
import { isoDate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { CredentialForm } from "../../credential-form";
import { updateCredential } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditCredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, opts] = await Promise.all([db.credential.findUnique({ where: { id } }), formOptions()]);
  if (!c) notFound();
  const action = updateCredential.bind(null, id);
  return (
    <div className="grid gap-6">
      <PageHeader title="Edit credential" />
      <CredentialForm
        action={action}
        {...opts}
        initial={{
          subjectType: c.subjectType,
          personId: c.personId,
          entityId: c.entityId,
          credentialTypeId: c.credentialTypeId,
          state: c.state,
          number: c.number,
          issuedOn: c.issuedOn ? isoDate(c.issuedOn) : "",
          expiresOn: c.expiresOn ? isoDate(c.expiresOn) : "",
          renewalLeadDays: c.renewalLeadDays,
          reverifyDays: c.reverifyDays,
          notes: c.notes,
          documentFileKey: c.documentFileKey,
        }}
        submitLabel="Save changes"
      />
    </div>
  );
}
