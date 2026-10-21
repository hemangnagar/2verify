import { storage } from "@/lib/storage";
import { Button } from "@/components/ui/button";

/** Server component: resolves a storage key to a short-lived signed link. */
export async function FileLink({ fileKey, label = "Download", variant = "outline" }: { fileKey: string | null; label?: string; variant?: "outline" | "link" | "default" }) {
  if (!fileKey) return <span className="text-muted-foreground">—</span>;
  const url = await storage().signedUrl(fileKey);
  return (
    <Button asChild variant={variant} size="sm">
      <a href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
    </Button>
  );
}

/** Server component: inline thumbnail for image evidence, or a link for anything else. */
export async function EvidenceThumb({ fileKey, className }: { fileKey: string | null; className?: string }) {
  if (!fileKey) return <span className="text-muted-foreground">no file</span>;
  const url = await storage().signedUrl(fileKey);
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(fileKey);
  if (!isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">
        {fileKey.split("/").pop()}
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="evidence" className={className ?? "h-24 w-auto rounded border object-cover"} />
    </a>
  );
}
