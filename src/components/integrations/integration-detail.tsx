"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  HourglassIcon,
  Loader2Icon,
  LockIcon,
  PlugIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UnplugIcon,
  WrenchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

import { GoCardlessConnectButton } from "./gocardless-connect";
import { PlaidConnectButton } from "./plaid-connect";
import { getProviderGuide } from "./provider-guide";
import { ProviderIcon } from "./provider-icons";
import { CAPABILITY_LABELS, type IntegrationCardData } from "./types";

/** Days before consent expiry at which the renew warning appears. */
const CONSENT_WARNING_DAYS = 14;

function consentDaysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const expires = Date.parse(iso);
  if (!Number.isFinite(expires)) return null;
  return Math.floor((expires - Date.now()) / (24 * 60 * 60 * 1000));
}

function rateLimitedUntilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const until = Date.parse(iso);
  if (!Number.isFinite(until) || until <= Date.now()) return null;
  return new Date(until).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never synced";
  return `Last synced ${new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function StatusBadge({ data }: { data: IntegrationCardData }) {
  if (!data.configured) return <Badge variant="secondary">Needs setup</Badge>;
  if (!data.connection) return <Badge variant="outline">Available</Badge>;
  switch (data.connection.status) {
    case "CONNECTED":
      return (
        <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          Connected
        </Badge>
      );
    case "ERROR":
      return <Badge variant="destructive">Error</Badge>;
    case "EXPIRED":
      return (
        <Badge className="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400">
          Expired
        </Badge>
      );
  }
}

function CopyEnvVar({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the text instead");
    }
  };
  return (
    <li className="flex items-center gap-1.5">
      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{name}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${name}`}
        className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
      >
        {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
      </button>
    </li>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3 text-sm">
          <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {index + 1}
          </span>
          <span className="text-muted-foreground pt-px">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Teams-style connect: paste an incoming webhook URL. */
function WebhookConnectDialog({ data }: { data: IntegrationCardData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/integrations/${data.id}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the webhook");
      toast.success(`${data.name} connected — a test message was posted`);
      setOpen(false);
      setUrl("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the webhook");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlugIcon className="size-4" />
          Connect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {data.name}</DialogTitle>
          <DialogDescription>
            Paste the incoming webhook URL for the target channel. A test message verifies it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`webhook-${data.id}`}>Webhook URL</Label>
          <Input
            id={`webhook-${data.id}`}
            placeholder="https://..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy || url.length < 12}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save & test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectAction({ data, reconnect }: { data: IntegrationCardData; reconnect?: boolean }) {
  if (data.flow === "plaid") return <PlaidConnectButton />;
  if (data.flow === "webhook") return <WebhookConnectDialog data={data} />;
  if (data.id === "gocardless") {
    return (
      <GoCardlessConnectButton
        defaultCountry={data.bankPickerCountry ?? "GB"}
        variant={reconnect ? "reconnect" : "connect"}
      />
    );
  }
  return (
    <Button size="sm" asChild>
      <a href={`/api/integrations/${data.id}/connect`}>
        <PlugIcon className="size-4" />
        {reconnect ? "Reconnect" : "Connect"}
      </a>
    </Button>
  );
}

export function IntegrationDetail({
  data,
  locked,
}: {
  data: IntegrationCardData;
  locked: boolean;
}) {
  const router = useRouter();
  const guide = getProviderGuide(data.id);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglingCalendar, setTogglingCalendar] = useState(false);

  const connection = data.connection;
  const daysLeft = consentDaysLeft(connection?.consentExpiresAt ?? null);
  const consentExpiring =
    connection?.status === "CONNECTED" &&
    daysLeft !== null &&
    daysLeft >= 0 &&
    daysLeft <= CONSENT_WARNING_DAYS;
  const rateLimitLabel = rateLimitedUntilLabel(connection?.rateLimitedUntil ?? null);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`/api/integrations/${data.id}/sync`, { method: "POST" });
      const body = (await response.json()) as {
        error?: string;
        stats?: Record<string, number>;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed");
      const summary = Object.entries(body.stats ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      toast.success(`${data.name} synced${summary ? ` (${summary})` : ""}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed");
      router.refresh();
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await fetch(`/api/integrations/${data.id}/disconnect`, {
        method: "POST",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not disconnect");
      toast.success(`${data.name} disconnected`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const toggleCalendar = async (enabled: boolean) => {
    setTogglingCalendar(true);
    try {
      const response = await fetch(`/api/integrations/${data.id}/options`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarEnabled: enabled }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not update options");
      }
      toast.success(enabled ? "Calendar events enabled" : "Calendar events disabled");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update options");
    } finally {
      setTogglingCalendar(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SheetHeader className="border-b">
        <div className="flex items-center gap-3">
          <ProviderIcon providerId={data.id} className="size-12" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle>{data.name}</SheetTitle>
              {locked ? (
                <Badge variant="secondary">
                  <LockIcon className="size-3" />
                  Business plan
                </Badge>
              ) : (
                <StatusBadge data={data} />
              )}
            </div>
            <SheetDescription>{data.description}</SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {data.capabilities.map((capability) => (
            <Badge key={capability} variant="outline" className="font-normal">
              {CAPABILITY_LABELS[capability] ?? capability}
            </Badge>
          ))}
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 p-4">
        {guide.bullets.length > 0 ? (
          <Section title="What it does" icon={<SparklesIcon className="size-4" />}>
            <ul className="text-muted-foreground space-y-1.5 text-sm">
              {guide.bullets.map((bullet, index) => (
                <li key={index} className="flex gap-2">
                  <span className="bg-foreground/40 mt-2 size-1 shrink-0 rounded-full" />
                  {bullet}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {guide.privacy.length > 0 ? (
          <Section title="Your data" icon={<ShieldCheckIcon className="size-4" />}>
            <ul className="text-muted-foreground space-y-1.5 text-sm">
              {guide.privacy.map((line, index) => (
                <li key={index} className="flex gap-2">
                  <span className="bg-foreground/40 mt-2 size-1 shrink-0 rounded-full" />
                  {line}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Separator />

        {locked ? (
          <div className="bg-muted/50 space-y-3 rounded-lg border p-4 text-center">
            <LockIcon className="text-muted-foreground mx-auto size-6" />
            <p className="text-sm font-medium">Integrations are a Business feature</p>
            <p className="text-muted-foreground text-sm">
              Upgrade to connect banks, accounting software and messaging tools.
            </p>
            <Button asChild size="sm">
              <Link href="/billing">Upgrade plan</Link>
            </Button>
          </div>
        ) : !data.configured ? (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg border p-4 text-sm">
              <p className="font-medium">Not available yet</p>
              <p className="text-muted-foreground mt-1">
                This integration hasn&apos;t been set up on this server. Ask your administrator to
                configure it — the steps are below.
              </p>
            </div>
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm font-medium select-none">
                <WrenchIcon className="size-4" />
                Setup for administrators
                <span className="text-muted-foreground ml-auto text-xs group-open:hidden">Show</span>
                <span className="text-muted-foreground ml-auto hidden text-xs group-open:inline">Hide</span>
              </summary>
              <div className="space-y-4 border-t p-3">
                {guide.adminUrl ? (
                  <a
                    href={guide.adminUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                  >
                    {guide.adminUrlLabel ?? guide.adminUrl}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
                <Steps steps={guide.adminSteps} />
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Environment variables
                  </p>
                  <ul className="space-y-1.5">
                    {data.requiredEnvVars.map((envVar) => (
                      <CopyEnvVar key={envVar} name={envVar} />
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    {data.missingEnvVars.length > 0
                      ? `Missing: ${data.missingEnvVars.join(", ")}`
                      : "All variables are set — restart the app to pick them up."}
                  </p>
                </div>
              </div>
            </details>
          </div>
        ) : !connection ? (
          <Section title="How to connect" icon={<PlugIcon className="size-4" />}>
            <Steps steps={guide.userSteps} />
            <div className="pt-2">
              <ConnectAction data={data} />
            </div>
          </Section>
        ) : (
          <div className="space-y-4">
            <Section title="Connection" icon={<PlugIcon className="size-4" />}>
              <div className="space-y-1.5 text-sm">
                {connection.accountLabel ? (
                  <p className="text-muted-foreground">{connection.accountLabel}</p>
                ) : null}
                {data.syncable ? (
                  <p className="text-muted-foreground">{formatLastSync(connection.lastSyncAt)}</p>
                ) : null}
                {consentExpiring ? (
                  <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                    <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Bank consent expires{" "}
                      {daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} —
                      renew it to keep syncing without interruption.
                    </span>
                  </p>
                ) : null}
                {rateLimitLabel ? (
                  <p className="text-muted-foreground flex items-start gap-1.5">
                    <HourglassIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Your bank&apos;s daily data limit was reached — syncing resumes automatically
                      after {rateLimitLabel}.
                    </span>
                  </p>
                ) : null}
                {connection.lastError ? (
                  <p className="text-destructive flex items-start gap-1.5">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-3">
                      {connection.status === "EXPIRED"
                        ? "Access expired — reconnect to resume syncing. Your imported data is unaffected."
                        : connection.lastError}
                    </span>
                  </p>
                ) : null}
              </div>
            </Section>

            {data.id === "google-calendar" ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <Label htmlFor="calendar-toggle" className="text-sm font-normal">
                  Create calendar events for upcoming bills
                </Label>
                <Switch
                  id="calendar-toggle"
                  checked={connection.calendarEnabled}
                  onCheckedChange={toggleCalendar}
                  disabled={togglingCalendar}
                />
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {connection.status === "EXPIRED" ? (
                <ConnectAction data={data} reconnect />
              ) : null}
              {consentExpiring && data.id === "gocardless" ? (
                <GoCardlessConnectButton
                  defaultCountry={data.bankPickerCountry ?? "GB"}
                  variant="renew"
                />
              ) : null}
              {data.syncable && connection.status !== "EXPIRED" ? (
                <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing}>
                  {syncing ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-4" />
                  )}
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={disconnect}
                disabled={disconnecting}
                className="text-muted-foreground"
              >
                {disconnecting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <UnplugIcon className="size-4" />
                )}
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
