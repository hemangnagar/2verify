"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addJurisdictionAction } from "../../actions";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export function JurisdictionForm({ orgId, existing }: { orgId: string; existing: string[] }) {
  const [state, action, pending] = useActionState(addJurisdictionAction.bind(null, orgId), undefined);
  const available = STATES.filter((s) => !existing.includes(s));
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Select name="state" className="w-24" required>
        {available.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Input name="note" placeholder="What was set up (board lookups, adapter, license rules)" className="min-w-80 flex-1" />
      <Button type="submit" variant="outline" disabled={pending}>
        Add jurisdiction (+$400/yr)
      </Button>
      {state?.error && <span className="text-sm text-destructive">{state.error}</span>}
      {state?.message && <span className="text-sm text-emerald-700">{state.message}</span>}
    </form>
  );
}
