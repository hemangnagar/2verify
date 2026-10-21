"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { autoVerifyAction } from "../actions";

export function AutoVerifyButton({ credentialId }: { credentialId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await autoVerifyAction(credentialId);
            if (r?.error) setError(r.error);
          })
        }
      >
        {pending ? "Querying the board…" : "Verify automatically"}
      </Button>
      {pending && <span className="text-sm text-muted-foreground">Opening the board page in a headless browser, usually 5–15 seconds.</span>}
      {error && <span className="text-sm text-destructive">Automated check failed: {error}. Use the guided form below.</span>}
    </div>
  );
}
