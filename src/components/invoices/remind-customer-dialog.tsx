"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, Loader2Icon, MailIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { InvoiceDto } from "@/lib/invoices/serialize";
import type { EmailDeliveryResult } from "@/lib/notifications/email";

/**
 * "Remind customer": an AI-written payment reminder the user reads, edits and
 * then sends. Three things it deliberately does not do — send without being
 * shown first, claim a delivery that did not happen, or become useless when
 * email is not configured (the draft is still right there to copy).
 */

interface HistoryEntry {
  id: string;
  kind: string;
  label: string;
  sentAt: string;
  toEmail: string;
  subject: string;
  automatic: boolean;
}

interface DraftResponse {
  eligible: boolean;
  reason?: string;
  invoiceId: string;
  customerName: string;
  recipient: string | null;
  emailConfigured: boolean;
  replyTo: string | null;
  history: HistoryEntry[];
  step?: string;
  stepLabel?: string;
  daysLate?: number;
  subject?: string;
  body?: string;
  source?: "ai" | "template";
}

const INELIGIBLE_MESSAGES: Record<string, string> = {
  not_receivable:
    "Reminders are for invoices you issued. This one is a bill you owe, so there is nobody to chase.",
  not_unpaid: "This invoice is not unpaid, so there is nothing to remind anyone about.",
  no_due_date: "Add a due date to this invoice first — a reminder needs a date to refer to.",
  not_due_yet: "This invoice is not due for more than a week yet.",
  already_sent:
    "The reminder for this stage has already been sent. The next one becomes available as the invoice gets further past due.",
};

export function RemindCustomerDialog({ invoice }: { invoice: InvoiceDto }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delivery, setDelivery] = useState<EmailDeliveryResult | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setDelivery(null);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/remind`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setLoadError(data?.error ?? "The reminder could not be drafted.");
        setDraft(null);
        return;
      }
      const payload = data as DraftResponse;
      setDraft(payload);
      setToEmail(payload.recipient ?? invoice.customerEmail ?? "");
      setSubject(payload.subject ?? "");
      setBody(payload.body ?? "");
    } catch {
      setLoadError("Network error — please try again.");
      setDraft(null);
    } finally {
      setIsLoading(false);
    }
  }, [invoice.id, invoice.customerEmail]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function send() {
    setIsSending(true);
    setDelivery(null);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: toEmail.trim(), subject, body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Reminder not sent", { description: data?.error });
        return;
      }
      const result = data.delivery as EmailDeliveryResult;
      setDelivery(result);
      if (result.status === "sent") {
        toast.success(`Reminder sent to ${toEmail.trim()}`);
        setOpen(false);
        router.refresh();
      }
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSending(false);
    }
  }

  function copyDraft() {
    void navigator.clipboard.writeText(`${subject}\n\n${body}`);
    toast.success("Draft copied");
  }

  const canSend =
    draft?.eligible === true && toEmail.trim().length > 0 && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MailIcon />
        Remind customer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Remind {invoice.vendor || "your customer"}</DialogTitle>
            <DialogDescription>
              {draft?.eligible
                ? `${draft.stepLabel} — read it, change anything you like, then send.`
                : "A payment reminder written from this invoice's own details."}
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Writing the reminder…
            </p>
          )}

          {!isLoading && loadError && <p className="text-destructive text-sm">{loadError}</p>}

          {!isLoading && draft && !draft.eligible && (
            <p className="text-muted-foreground text-sm">
              {INELIGIBLE_MESSAGES[draft.reason ?? ""] ?? "There is nothing to send for this invoice."}
            </p>
          )}

          {!isLoading && draft?.eligible && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-to">To</Label>
                <Input
                  id="reminder-to"
                  type="email"
                  value={toEmail}
                  onChange={(event) => setToEmail(event.target.value)}
                  placeholder="customer@example.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-subject">Subject</Label>
                <Input
                  id="reminder-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-body">Message</Label>
                <Textarea
                  id="reminder-body"
                  rows={12}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {draft.source === "ai"
                    ? "Drafted by AI from this invoice only — it was given no other details."
                    : "Written from a template because no AI provider is configured."}
                  {draft.replyTo ? ` Replies go to ${draft.replyTo}.` : ""}
                </p>
              </div>

              {!draft.emailConfigured && (
                <p className="text-muted-foreground text-xs">
                  Email delivery isn&apos;t set up on this server, so copy the draft and send it
                  from your own mail client. Set{" "}
                  <code className="font-mono">RESEND_API_KEY</code> and{" "}
                  <code className="font-mono">EMAIL_FROM</code> to send from here.
                </p>
              )}

              {delivery && delivery.status !== "sent" && (
                <div className="text-muted-foreground flex flex-col gap-1 text-xs">
                  {delivery.status === "not_configured" ? (
                    <p>Nothing was sent: email delivery isn&apos;t configured. Copy the draft instead.</p>
                  ) : delivery.domainRestricted ? (
                    <p>
                      Resend only delivers to your own address until you verify a sending domain,
                      so this reminder was not delivered. Copy the draft, or verify a domain.
                    </p>
                  ) : (
                    <p>The reminder could not be delivered, so nothing was recorded.</p>
                  )}
                  {delivery.error && (
                    <details>
                      <summary className="cursor-pointer">Provider response</summary>
                      <p className="mt-1 break-words">{delivery.error}</p>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {!isLoading && draft && draft.history.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Already sent</p>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {draft.history.map((entry) => (
                  <li key={entry.id}>
                    {entry.label} · {new Date(entry.sentAt).toLocaleDateString()} · {entry.toEmail}
                    {entry.automatic ? " · automatic" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSending}>
              Close
            </Button>
            {draft?.eligible && (
              <>
                <Button variant="outline" onClick={copyDraft}>
                  <CopyIcon />
                  Copy draft
                </Button>
                <Button onClick={send} disabled={!canSend || isSending}>
                  {isSending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Send reminder
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
