"use client";

import { useActionState } from "react";
import type { Plan } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/page-header";
import { createOrgAction } from "../../actions";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export function OrgForm({ plans }: { plans: Plan[] }) {
  const [state, action, pending] = useActionState(createOrgAction, undefined);
  return (
    <form action={action} className="grid max-w-3xl gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Organization name">
          <Input name="name" required placeholder="Harbor Compounding" />
        </Field>
        <Field label="Slug" hint="Short id used in URLs and file storage">
          <Input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,40}" placeholder="harbor" />
        </Field>
        <Field label="Plan">
          <Select name="planId" defaultValue={plans.find((p) => p.name === "Core")?.id ?? plans[0]?.id}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — ${(p.annualPriceCents / 100).toLocaleString()}/yr, {p.creditsPerYear.toLocaleString()} credits
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue="trial">
            <option value="trial">trial</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
          </Select>
        </Field>
      </div>
      <Field label="Subscribed jurisdictions ($400 each per year)">
        <div className="grid grid-cols-6 gap-1 rounded-md border p-3 text-sm sm:grid-cols-9 lg:grid-cols-13">
          {STATES.map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="checkbox" name="states[]" value={s} /> {s}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First admin name">
          <Input name="adminName" required />
        </Field>
        <Field label="First admin email" hint="Receives the invite with a temporary password">
          <Input name="adminEmail" type="email" required />
        </Field>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create organization"}
        </Button>
      </div>
    </form>
  );
}
