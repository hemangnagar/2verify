"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/page-header";
import type { ActionState } from "@/lib/action";

export function VerifyForm({
  action,
  sourceUrl,
  defaultExpiration,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  sourceUrl: string;
  defaultExpiration: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  function attach(file: File) {
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileRef.current) fileRef.current.files = dt.files;
    setPreview({ url: URL.createObjectURL(file), name: file.name });
  }

  return (
    <form action={formAction} className="grid gap-5">
      <input type="hidden" name="sourceUrl" value={sourceUrl} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Status shown by the board">
          <Select name="result" defaultValue="active" required>
            <option value="active">Active / current</option>
            <option value="expired">Expired / lapsed</option>
            <option value="suspended">Suspended / revoked / probation</option>
            <option value="not_found">Not found</option>
            <option value="mismatch">Found, but details do not match</option>
          </Select>
        </Field>
        <Field label="Expiration date shown" hint="Leave blank if the board shows none">
          <Input name="expirationSeen" type="date" defaultValue={defaultExpiration} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="disciplineFlag" /> Board lists disciplinary action, probation, or a public record action
      </label>
      <Field label="Note">
        <Textarea name="note" placeholder="Anything a surveyor should know (e.g. renewal pending, name change)" />
      </Field>
      <Field label="Evidence: screenshot of the board page (required)" hint="Paste a screenshot here (Ctrl/Cmd+V after taking one), or choose a file.">
        <div
          tabIndex={0}
          onPaste={(e) => {
            const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
            if (item) {
              const f = item.getAsFile();
              if (f) attach(new File([f], `pasted-${Date.now()}.png`, { type: f.type }));
              e.preventDefault();
            }
          }}
          className="grid gap-2 rounded-md border border-dashed p-4 text-sm outline-none focus:ring-2 focus:ring-ring/50"
        >
          <span className="text-muted-foreground">Click here, then paste.</span>
          <Input
            ref={fileRef}
            name="evidence"
            type="file"
            accept="image/*,.pdf"
            required
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPreview({ url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "", name: f.name });
            }}
          />
          {preview && (
            <div className="flex items-center gap-3">
              {preview.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.url} alt="evidence preview" className="h-32 w-auto rounded border" />
              )}
              <span className="text-xs text-muted-foreground">{preview.name}</span>
            </div>
          )}
        </div>
      </Field>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving evidence…" : "Save verification"}
        </Button>
      </div>
    </form>
  );
}
