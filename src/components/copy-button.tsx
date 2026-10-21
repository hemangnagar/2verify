"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title={`Copy ${value}`}
    >
      <span className="font-mono">{label ?? value}</span>
      <span className="text-muted-foreground">{done ? "copied" : "copy"}</span>
    </Button>
  );
}
