"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { runScreeningNow } from "./actions";

export function RunButtons({ mode }: { mode: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const run = (source: "oig_leie" | "sam") =>
    start(async () => {
      setMsg(null);
      const r = await runScreeningNow(source);
      setMsg(r?.error ? `Failed: ${r.error}` : `${source === "oig_leie" ? "OIG LEIE" : "SAM"} screening complete.`);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => run("oig_leie")}>
        {pending ? "Running…" : "Run OIG LEIE now"}
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => run("sam")}>
        {pending ? "Running…" : "Run SAM now"}
      </Button>
      <span className="text-xs text-muted-foreground">mode: {mode}</span>
      {msg && <span className="text-sm">{msg}</span>}
    </div>
  );
}
