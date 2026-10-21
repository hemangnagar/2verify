import type { CredentialCategory, PersonRole } from "@prisma/client";

/** Credential type catalog. Names are stable identifiers used by the demo seed and the CSV importer. */
export const CREDENTIAL_TYPES: Array<{
  name: string;
  category: CredentialCategory;
  defaultLeadDays: number;
  defaultReverifyDays: number;
  stateSpecific: boolean;
  psvRequired?: boolean;
  requiredForRoles?: PersonRole[];
}> = [
  { name: "Pharmacist License", category: "license", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: true },
  { name: "Pharmacy Technician License", category: "license", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: true },
  { name: "Pharmacy Intern License", category: "license", defaultLeadDays: 60, defaultReverifyDays: 365, stateSpecific: true },
  { name: "Prescriber State License", category: "license", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: true },
  { name: "Pharmacy Permit", category: "permit", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: true },
  { name: "Nonresident Pharmacy Permit", category: "permit", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: true },
  { name: "DEA Registration", category: "registration", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: false },
  { name: "State Controlled Substance Registration", category: "registration", defaultLeadDays: 90, defaultReverifyDays: 365, stateSpecific: true },
  { name: "NPI", category: "registration", defaultLeadDays: 0, defaultReverifyDays: 365, stateSpecific: false },
  { name: "Professional Liability Insurance", category: "insurance", defaultLeadDays: 60, defaultReverifyDays: 365, stateSpecific: false, psvRequired: false },
  { name: "URAC Specialty Pharmacy Accreditation", category: "accreditation", defaultLeadDays: 180, defaultReverifyDays: 1095, stateSpecific: false },
  { name: "HIPAA Training", category: "training", defaultLeadDays: 30, defaultReverifyDays: 365, stateSpecific: false, psvRequired: false, requiredForRoles: ["pharmacist", "technician", "intern", "staff"] },
  { name: "Fraud, Waste & Abuse Training", category: "training", defaultLeadDays: 30, defaultReverifyDays: 365, stateSpecific: false, psvRequired: false, requiredForRoles: ["pharmacist", "technician", "intern", "staff"] },
];

/**
 * Board lookup URLs for the demo states. Tokens: {number} {last_name} {first_name}.
 * These are the boards' public verification entry points as of Oct 2026; confirm each
 * during Phase 1 for the pharmacy's actual states and adjust in /settings/board-lookups.
 */
export const BOARD_LOOKUPS: Array<{ state: string; typeName: string; boardName: string; urlTemplate: string; notes: string }> = [
  {
    state: "NV", typeName: "Pharmacist License", boardName: "Nevada State Board of Pharmacy",
    urlTemplate: "https://nvbop.glsuite.us/GLSuiteWeb/Clients/NVBOP/Public/Verification/Search.aspx",
    notes: "GLSuite search. Enter the license number in 'License Number' and submit. Result shows License Status (Active/Expired/Suspended), Expiration Date, and a Disciplinary Action section at the bottom of the detail page.",
  },
  {
    state: "NV", typeName: "Pharmacy Technician License", boardName: "Nevada State Board of Pharmacy",
    urlTemplate: "https://nvbop.glsuite.us/GLSuiteWeb/Clients/NVBOP/Public/Verification/Search.aspx",
    notes: "Same GLSuite search as pharmacists. Choose license type 'Pharmaceutical Technician' if the number is not unique. Expiration shows as 'Expiration Date'.",
  },
  {
    state: "NV", typeName: "Pharmacy Permit", boardName: "Nevada State Board of Pharmacy",
    urlTemplate: "https://nvbop.glsuite.us/GLSuiteWeb/Clients/NVBOP/Public/Verification/Search.aspx",
    notes: "Search by license number with type 'Pharmacy'. Nonresident pharmacies appear under 'Pharmacy - Nonresident'.",
  },
  {
    state: "CA", typeName: "Pharmacist License", boardName: "California State Board of Pharmacy (DCA License Search)",
    urlTemplate: "https://search.dca.ca.gov/results?boardCode=0&licenseType=RPH&licenseNumber={number}",
    notes: "DCA search pre-filters to license type RPH. The result card shows License Status, Expiration Date, and 'Disciplinary Actions / Public Record Actions' when present. Click the name for the detail page before capturing.",
  },
  {
    state: "CA", typeName: "Pharmacy Technician License", boardName: "California State Board of Pharmacy (DCA License Search)",
    urlTemplate: "https://search.dca.ca.gov/results?boardCode=0&licenseType=TCH&licenseNumber={number}",
    notes: "License type TCH. Enter the number without the 'TCH' prefix if the search returns nothing.",
  },
  {
    state: "CA", typeName: "Pharmacy Permit", boardName: "California State Board of Pharmacy (DCA License Search)",
    urlTemplate: "https://search.dca.ca.gov/results?boardCode=0&licenseType=PHY&licenseNumber={number}",
    notes: "License type PHY for in-state pharmacies, NRP for nonresident pharmacies. Status and expiration on the result card.",
  },
  {
    state: "AZ", typeName: "Pharmacist License", boardName: "Arizona State Board of Pharmacy",
    urlTemplate: "https://pharmacypermits.az.gov/license-verification",
    notes: "Search by license number or name. Result shows Status, Expiration Date, and whether discipline is on file; the discipline detail is a separate link.",
  },
  {
    state: "AZ", typeName: "Pharmacy Technician License", boardName: "Arizona State Board of Pharmacy",
    urlTemplate: "https://pharmacypermits.az.gov/license-verification",
    notes: "Same verification page. Technician licenses start with T; trainees with TT.",
  },
  {
    state: "AZ", typeName: "Pharmacy Permit", boardName: "Arizona State Board of Pharmacy",
    urlTemplate: "https://pharmacypermits.az.gov/license-verification",
    notes: "Permit numbers start with Y. Nonresident permits are listed as 'Nonresident Pharmacy'.",
  },
  {
    state: "AZ", typeName: "Nonresident Pharmacy Permit", boardName: "Arizona State Board of Pharmacy",
    urlTemplate: "https://pharmacypermits.az.gov/license-verification",
    notes: "Same page; permit type shows as 'Nonresident Pharmacy'.",
  },
  {
    state: "CA", typeName: "Nonresident Pharmacy Permit", boardName: "California State Board of Pharmacy (DCA License Search)",
    urlTemplate: "https://search.dca.ca.gov/results?boardCode=0&licenseType=NRP&licenseNumber={number}",
    notes: "License type NRP.",
  },
  {
    state: "NV", typeName: "Prescriber State License", boardName: "Nevada State Board of Medical Examiners",
    urlTemplate: "https://nsbme.us.thentiacloud.net/webs/nsbme/register/",
    notes: "Search by name or license number. Shows Status, Expiration, and Board Actions.",
  },
  {
    state: "CA", typeName: "Prescriber State License", boardName: "Medical Board of California (DCA License Search)",
    urlTemplate: "https://search.dca.ca.gov/results?boardCode=0&licenseType=800&licenseNumber={number}",
    notes: "Physician and Surgeon licenses are type 800 (A / G / C prefixes). Status, expiration, and public record actions on the card.",
  },
];

/** Fill a URL template with credential values. */
export function fillTemplate(template: string, v: { number?: string | null; lastName?: string; firstName?: string }): string {
  return template
    .replace("{number}", encodeURIComponent((v.number ?? "").replace(/\s+/g, "")))
    .replace("{last_name}", encodeURIComponent(v.lastName ?? ""))
    .replace("{first_name}", encodeURIComponent(v.firstName ?? ""));
}
