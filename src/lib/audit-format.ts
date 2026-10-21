/** Human-readable diff summary for an audit row. */
export function changedFields(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  if (!before) return "created";
  if (!after) return "deleted";
  const keys = Object.keys(a).filter((k) => k !== "updatedAt" && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return keys.length ? keys.map((k) => `${k}: ${fmt(b[k])} → ${fmt(a[k])}`).join("; ") : "no field changes";
}

function fmt(v: unknown) {
  if (v === null || v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}
