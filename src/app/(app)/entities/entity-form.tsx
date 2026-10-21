"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/page-header";
import type { ActionState } from "@/lib/action";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export function EntityForm({ action, initial, submitLabel = "Save" }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; initial?: { name: string; npi: string | null; deaNumber: string | null; state: string; address: string; isPrimary: boolean }; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid max-w-2xl gap-5">
      <Field label="Name">
        <Input name="name" defaultValue={initial?.name ?? ""} required />
      </Field>
      <Field label="Address">
        <Input name="address" defaultValue={initial?.address ?? ""} required />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="State">
          <Select name="state" defaultValue={initial?.state ?? "NV"}>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="NPI (organization)">
          <Input name="npi" inputMode="numeric" pattern="\d{10}" defaultValue={initial?.npi ?? ""} />
        </Field>
        <Field label="DEA number">
          <Input name="deaNumber" defaultValue={initial?.deaNumber ?? ""} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPrimary" defaultChecked={initial?.isPrimary ?? false} /> Primary legal entity
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
