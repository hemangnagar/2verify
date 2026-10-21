import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/credential-types">
          <Card className="h-full hover:bg-muted/40">
            <CardHeader>
              <CardTitle>Credential types</CardTitle>
              <CardDescription>Catalog with default lead days, re-verification intervals, and required-by-role training.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/settings/board-lookups">
          <Card className="h-full hover:bg-muted/40">
            <CardHeader>
              <CardTitle>Board lookups</CardTitle>
              <CardDescription>Per state and credential type: where the verifier goes and what the page shows.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Alert recipients</CardTitle>
            <CardDescription>Set with the ALERT_CC environment variable (comma-separated). Every active admin user also receives every alert.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">ALERT_CC = {process.env.ALERT_CC || "(not set)"}</CardContent>
        </Card>
      </div>
    </div>
  );
}
