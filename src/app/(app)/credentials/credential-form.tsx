"use client";

import { useActionState, useMemo, useState } from "react";
import type { CredentialType, Entity, Person } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/page-header";
import type { ActionState } from "@/lib/action";

type PersonOpt = Person & { entity: Entity | null };

export interface CredentialFormValues {
  subjectType: "person" | "entity";
  personId: string | null;
  entityId: string | null;
  credentialTypeId: string;
  state: string | null;
  number: string | null;
  issuedOn: string;
  expiresOn: string;
  renewalLeadDays: number;
  reverifyDays: number;
  notes: string | null;
  documentFileKey: string | null;
}

export function CredentialForm({
  action,
  initial,
  types,
  people,
  entities,
  states,
  submitLabel = "Save credential",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Partial<CredentialFormValues>;
  types: CredentialType[];
  people: PersonOpt[];
  entities: Entity[];
  states: string[];
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [subjectType, setSubjectType] = useState<"person" | "entity">(initial?.subjectType ?? "person");
  const [typeId, setTypeId] = useState(initial?.credentialTypeId ?? types[0]?.id ?? "");
  const type = useMemo(() => types.find((t) => t.id === typeId), [types, typeId]);
  const [lead, setLead] = useState(initial?.renewalLeadDays ?? type?.defaultLeadDays ?? 90);
  const [reverify, setReverify] = useState(initial?.reverifyDays ?? type?.defaultReverifyDays ?? 365);

  function onTypeChange(id: string) {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t) {
      setLead(t.defaultLeadDays);
      setReverify(t.defaultReverifyDays);
    }
  }

  return (
    <form action={formAction} className="grid max-w-2xl gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Belongs to">
          <Select name="subjectType" value={subjectType} onChange={(e) => setSubjectType(e.target.value as "person" | "entity")}>
            <option value="person">A person</option>
            <option value="entity">A location / legal entity</option>
          </Select>
        </Field>
        {subjectType === "person" ? (
          <Field label="Person">
            <Select name="personId" defaultValue={initial?.personId ?? ""} required>
              <option value="">Select…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.lastName}, {p.firstName} — {p.role}
                  {p.entity ? ` (${p.entity.name})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Location">
            <Select name="entityId" defaultValue={initial?.entityId ?? ""} required>
              <option value="">Select…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Credential type">
          <Select name="credentialTypeId" value={typeId} onChange={(e) => onTypeChange(e.target.value)} required>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="State" hint={type?.stateSpecific ? undefined : "Not state-specific for this type"}>
          <Select name="state" defaultValue={initial?.state ?? ""} disabled={!type?.stateSpecific}>
            <option value="">—</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Number">
          <Input name="number" defaultValue={initial?.number ?? ""} placeholder="License / permit / policy number" />
        </Field>
        <div />
        <Field label="Issued on">
          <Input name="issuedOn" type="date" defaultValue={initial?.issuedOn ?? ""} />
        </Field>
        <Field label="Expires on" hint="Leave blank if it does not expire (e.g. NPI)">
          <Input name="expiresOn" type="date" defaultValue={initial?.expiresOn ?? ""} />
        </Field>
        <Field label="Renewal lead (days)" hint="First alert goes out this many days before expiry">
          <Input name="renewalLeadDays" type="number" min={0} value={lead} onChange={(e) => setLead(Number(e.target.value))} />
        </Field>
        <Field label="Re-verify every (days)" hint="Primary-source verification interval">
          <Input name="reverifyDays" type="number" min={1} value={reverify} onChange={(e) => setReverify(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Document" hint={initial?.documentFileKey ? `Current: ${initial.documentFileKey.split("/").pop()} — upload to replace` : "Certificate, permit, policy, or completion record"}>
        <Input name="document" type="file" accept=".pdf,.png,.jpg,.jpeg" />
      </Field>
      <Field label="Notes">
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
      </Field>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
