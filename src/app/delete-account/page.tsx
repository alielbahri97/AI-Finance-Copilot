import type { Metadata } from "next";
import Link from "next/link";
import { ClockIcon, DatabaseIcon, MailIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";

import { BallastLogo } from "@/components/brand/ballast-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCOUNT_DELETION_GRACE_PERIOD_DAYS, serializeDeletionRequest } from "@/lib/account/deletion";
import { BRAND } from "@/lib/branding";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

import { DeleteAccountForm, type ScheduledRequest } from "./delete-account-form";

/**
 * The public account-deletion page required by Google Play's data deletion
 * policy: a URL a reviewer can open in a browser, with no app installed and no
 * account, that explains what deletion does and how to ask for it.
 *
 * Everything below the explanation degrades rather than redirects. Not signed
 * in, Supabase unreachable, database down — the page still renders the policy
 * text and the support address, because a redirect to /login is exactly the
 * failure mode that gets a submission rejected. The route sits outside the
 * middleware's protected prefixes for the same reason.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Delete your account",
  description: `How to permanently delete your ${BRAND.name} account and what happens to your data.`,
  robots: { index: true, follow: true },
};

const ERASED = [
  "Your profile: name, email address, avatar and settings",
  "Every transaction, category, budget, savings goal, asset and invoice",
  "Bank and accounting connections, and the accounts synced through them",
  "Copilot conversations and the messages in them",
  "Notifications, push subscriptions and notification preferences",
  "Referrals you made or received",
  "Any workspace that only you are in, and everything inside it",
];

const RETAINED = [
  `A record that a deletion happened, holding a one-way hash of your email address instead of the address itself. This is how we can answer "was this account deleted, and when" without keeping your data.`,
  "Security audit entries in shared workspaces that other people still use. Those entries are that workspace's security record, not yours, and your user id is removed from them so they no longer name you.",
  "Invoices and payment records Stripe keeps for its own legal and tax obligations, under Stripe's retention rules rather than ours.",
];

async function loadScheduledRequest(userId: string): Promise<ScheduledRequest | null> {
  try {
    const row = await prisma.accountDeletionRequest.findFirst({
      where: { userId, status: "SCHEDULED" },
      orderBy: { requestedAt: "desc" },
    });
    return row ? serializeDeletionRequest(row) : null;
  } catch (error) {
    // The informational half of this page is the part Google checks. A
    // database problem must not take it down with it.
    logger.error("delete_account_page_lookup_failed", { error: serializeError(error) });
    return null;
  }
}

export default async function DeleteAccountPage() {
  let email: string | null = null;
  let userId: string | null = null;
  try {
    const user = await getUser();
    userId = user?.id ?? null;
    email = user?.email ?? null;
  } catch (error) {
    logger.warn("delete_account_page_auth_unavailable", { error: serializeError(error) });
  }

  const scheduled = userId ? await loadScheduledRequest(userId) : null;

  return (
    <div className="relative flex min-h-svh flex-col items-center px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,oklch(0.5_0.22_255/0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.57_0.19_255/0.14),transparent_50%)]"
      />
      <Link href="/" className="transition-opacity hover:opacity-90">
        <BallastLogo />
      </Link>

      <main id="main-content" tabIndex={-1} className="mt-8 w-full max-w-2xl space-y-6 outline-none">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Delete your {BRAND.name} account
          </h1>
          <p className="text-muted-foreground text-sm">
            This page explains exactly what deleting your account erases, what we are required to
            keep, and how to ask for it. If you are signed in you can start the deletion here.
          </p>
        </div>

        <Alert variant="warning">
          <ClockIcon />
          <AlertTitle>
            Deletion happens after {ACCOUNT_DELETION_GRACE_PERIOD_DAYS} days, not immediately
          </AlertTitle>
          <AlertDescription>
            <p>
              Asking for deletion schedules it {ACCOUNT_DELETION_GRACE_PERIOD_DAYS} days out and
              emails you. Nothing is erased during those {ACCOUNT_DELETION_GRACE_PERIOD_DAYS} days
              and you can cancel at any point. The delay exists so that somebody who gets into your
              account cannot destroy it before you notice. After the {ACCOUNT_DELETION_GRACE_PERIOD_DAYS}{" "}
              days the deletion is permanent and cannot be undone.
            </p>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2Icon className="size-4" />
              What is permanently erased
            </CardTitle>
            <CardDescription>
              Deleted from our database, not hidden or deactivated. Your sign-in credentials are
              removed too, so the account can no longer be used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
              {ERASED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DatabaseIcon className="size-4" />
              What is kept, and for how long
            </CardTitle>
            <CardDescription>
              Kept indefinitely, because each of these exists to protect somebody: you, another
              customer, or a legal obligation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
              {RETAINED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4" />
              Before you start
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
              <li>
                Export anything you want to keep first — once the {ACCOUNT_DELETION_GRACE_PERIOD_DAYS}{" "}
                days are up there is nothing left to export.
              </li>
              <li>
                A paid subscription on a workspace that goes with you is cancelled at the same time.
                You are not billed for it again.
              </li>
              <li>
                Bank connections are withdrawn at the provider, so the bank stops sharing data with
                us.
              </li>
              <li>
                If you are the last owner of a workspace other people are still in, hand it over or
                remove them first. That workspace is theirs as much as yours, so we will not delete
                it out from under them.
              </li>
            </ul>
          </CardContent>
        </Card>

        {email ? (
          <DeleteAccountForm email={email} scheduled={scheduled} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>How to request deletion</CardTitle>
              <CardDescription>You need to be signed in, so that we know it is you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
                <li>Sign in to your {BRAND.name} account.</li>
                <li>Come back to this page, or open Settings then Delete account in the app.</li>
                <li>
                  Type <span className="font-mono font-semibold">DELETE</span> to confirm. We email
                  you straight away with the date it will happen and a link to cancel.
                </li>
              </ol>
              <Button asChild>
                <Link href="/login?next=/delete-account">Sign in to delete your account</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailIcon className="size-4" />
              If you cannot sign in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Reset your password from the{" "}
              <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
                forgot password
              </Link>{" "}
              page. If you still cannot get in, email us from the address on the account and we will
              handle the deletion for you.
            </p>
            <p>
              <a
                href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent("Account deletion request")}`}
                className="text-primary font-medium underline-offset-4 hover:underline"
              >
                {BRAND.supportEmail}
              </a>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
