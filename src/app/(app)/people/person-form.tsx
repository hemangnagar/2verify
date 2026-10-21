"use client";

import { useActionState } from "react";
import type { Entity } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/page-header";
import type { ActionState } from "@/lib/action";

export interface PersonFormValues {
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  entityId: string | null;
  dob: string;
  npi: string | null;
  hireDate: string;
  active: boolean;
}

export function PersonForm({ action, initial, entities, submitLabel = "Save" }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; initial?: Partial<PersonFormValues>; entities: Entity[]; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid max-w-2xl gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name">
          <Input name="firstName" defaultValue={initial?.firstName ?? ""} required />
        </Field>
        <Field label="Last name">
          <Input name="lastName" defaultValue={initial?.lastName ?? ""} required />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue={initial?.role ?? "technician"}>
            {["pharmacist", "technician", "intern", "prescriber", "staff"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Home location" hint="Leave blank for outside prescribers">
          <Select name="entityId" defaultValue={initial?.entityId ?? ""}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email" hint="Receives expiry alerts for their own credentials">
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </Field>
        <Field label="NPI" hint="Verified against NPPES on save">
          <Input name="npi" inputMode="numeric" pattern="\d{10}" defaultValue={initial?.npi ?? ""} />
        </Field>
        <Field label="Date of birth" hint="Used only for exclusion-list matching">
          <Input name="dob" type="date" defaultValue={initial?.dob ?? ""} />
        </Field>
        <Field label="Hire / start date">
          <Input name="hireDate" type="date" defaultValue={initial?.hireDate ?? ""} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} /> Active (screened monthly, shown in queues)
      </label>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
