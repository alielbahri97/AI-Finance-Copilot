"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** The subset of the API's request shape this page renders. */
export interface ScheduledRequest {
  id: string;
  status: string;
  scheduledFor: string;
  requestedAt: string;
}

interface BlockingWorkspace {
  id: string;
  name: string;
  memberCount: number;
}

const CONFIRMATION = "DELETE";

/**
 * Absolute UTC, formatted the same on the server and in the browser. A
 * locale-and-timezone-dependent format would render differently in each and
 * trip a hydration mismatch on a page whose whole job is to render reliably.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatUtc(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${DATE_FORMAT.format(date)} UTC`;
}

export function DeleteAccountForm({
  email,
  scheduled: initialScheduled,
}: {
  email: string;
  scheduled: ScheduledRequest | null;
}) {
  const [scheduled, setScheduled] = useState<ScheduledRequest | null>(initialScheduled);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [blocking, setBlocking] = useState<BlockingWorkspace[]>([]);
  const [cancelled, setCancelled] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    setBlocking([]);
    try {
      const response = await fetch("/api/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm, reason: reason.trim() || undefined }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            request?: ScheduledRequest;
            error?: string;
            code?: string;
            workspaces?: BlockingWorkspace[];
          }
        | null;

      if (!response.ok) {
        if (body?.code === "REAUTH_REQUIRED") setNeedsSignIn(true);
        if (body?.code === "SOLE_OWNER") setBlocking(body.workspaces ?? []);
        setError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (body?.request) {
        setScheduled(body.request);
        setCancelled(false);
        setConfirm("");
      }
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/deletion", { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "We could not cancel the deletion. Please try again.");
        return;
      }
      setScheduled(null);
      setCancelled(true);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (scheduled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your account is scheduled for deletion</CardTitle>
          <CardDescription>
            Signed in as {email}. Nothing has been erased yet — you can still stop this.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <AlertTriangleIcon />
            <AlertTitle>Deletion runs on {formatUtc(scheduled.scheduledFor)}</AlertTitle>
            <AlertDescription>
              <p>
                Requested on {formatUtc(scheduled.requestedAt)}. After that date your account and
                its data are permanently gone and cannot be restored.
              </p>
            </AlertDescription>
          </Alert>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button variant="outline" onClick={cancel} disabled={busy}>
            {busy ? "Cancelling…" : "Cancel the deletion"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete this account</CardTitle>
        <CardDescription>Signed in as {email}.</CardDescription>
      </CardHeader>
      <CardContent>
        {cancelled ? (
          <Alert className="mb-4">
            <CheckCircle2Icon />
            <AlertTitle>Deletion cancelled</AlertTitle>
            <AlertDescription>
              <p>Your account and everything in it are untouched.</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deletion-reason">Why are you leaving? (optional)</Label>
            <Textarea
              id="deletion-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              placeholder="This helps us fix what drove you away. It is deleted along with your account."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="deletion-confirm">
              Type <span className="font-mono font-semibold">{CONFIRMATION}</span> to confirm
            </Label>
            <Input
              id="deletion-confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={confirm.length > 0 && confirm !== CONFIRMATION}
            />
          </div>

          {blocking.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Hand these workspaces over first</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {blocking.map((workspace) => (
                    <li key={workspace.id}>
                      {workspace.name} — {workspace.memberCount} members
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {error && blocking.length === 0 ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{needsSignIn ? "Sign in again to continue" : "That did not work"}</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                {needsSignIn ? (
                  <Link
                    href="/login?next=/delete-account"
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    Sign in again
                  </Link>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" variant="destructive" disabled={busy || confirm !== CONFIRMATION}>
            {busy ? "Scheduling…" : "Delete my account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
