import type { CredentialStatus, MatchDisposition, VerificationResult } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const STATUS: Record<CredentialStatus, "success" | "warning" | "destructive" | "secondary"> = {
  active: "success",
  expiring: "warning",
  expired: "destructive",
  suspended: "destructive",
  unknown: "secondary",
};

export function StatusBadge({ status }: { status: CredentialStatus }) {
  return <Badge variant={STATUS[status]}>{status}</Badge>;
}

const RESULT: Record<VerificationResult, "success" | "warning" | "destructive" | "secondary"> = {
  active: "success",
  expired: "destructive",
  suspended: "destructive",
  not_found: "destructive",
  mismatch: "warning",
};

export function ResultBadge({ result }: { result: VerificationResult }) {
  return <Badge variant={RESULT[result]}>{result.replace("_", " ")}</Badge>;
}

const DISPOSITION: Record<MatchDisposition, "warning" | "secondary" | "destructive"> = {
  pending: "warning",
  false_positive: "secondary",
  confirmed: "destructive",
};

export function DispositionBadge({ disposition }: { disposition: MatchDisposition }) {
  return <Badge variant={DISPOSITION[disposition]}>{disposition.replace("_", " ")}</Badge>;
}
