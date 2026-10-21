/** Fill a board lookup URL template. Tokens: {number} {last_name} {first_name}. */
export function fillTemplate(template: string, v: { number?: string | null; lastName?: string; firstName?: string }): string {
  return template
    .replace("{number}", encodeURIComponent((v.number ?? "").replace(/\s+/g, "")))
    .replace("{last_name}", encodeURIComponent(v.lastName ?? ""))
    .replace("{first_name}", encodeURIComponent(v.firstName ?? ""));
}
