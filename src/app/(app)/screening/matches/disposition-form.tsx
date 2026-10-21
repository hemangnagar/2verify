"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setDisposition } from "../actions";

export function DispositionForm({ matchId }: { matchId: string }) {
  const [state, action, pending] = useActionState(setDisposition, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
      <input type="hidden" name="matchId" value={matchId} />
      <Input name="reviewNote" placeholder="Why (e.g. different DOB and state; not our prescriber)" className="min-w-72 flex-1" />
      <Button type="submit" name="disposition" value="false_positive" variant="secondary" disabled={pending}>
        Dismiss as false positive
      </Button>
      <Button type="submit" name="disposition" value="confirmed" variant="destructive" disabled={pending}>
        Confirm match
      </Button>
      {state?.error && <span className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}
