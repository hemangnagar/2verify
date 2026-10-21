"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteCredential } from "../actions";

export function DeleteCredentialButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="destructive"
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this credential? This only works while it has no verification evidence.")) start(() => deleteCredential(id));
      }}
    >
      Delete
    </Button>
  );
}
