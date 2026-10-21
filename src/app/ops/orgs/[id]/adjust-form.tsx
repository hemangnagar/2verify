"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adjustCreditsAction } from "../../actions";

export function AdjustForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(adjustCreditsAction.bind(null, orgId), undefined);
  return (
    <form action={action} className="grid gap-3">
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <Input name="delta" type="number" placeholder="+100 / -5" required />
        <Select name="reason" defaultValue="adjustment">
          <option value="adjustment">adjustment (correction)</option>
          <option value="overage">overage pack (purchased)</option>
          <option value="allotment">allotment</option>
        </Select>
      </div>
      <Input name="note" placeholder="Why (goes on the ledger)" />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          Post
        </Button>
      </div>
    </form>
  );
}
