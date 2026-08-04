"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  HourglassIcon,
  Loader2Icon,
  PlugIcon,
  RefreshCwIcon,
  UnplugIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";

import { GoCardlessConnectButton } from "./gocardless-connect";
import { PlaidConnectButton } from "./plaid-connect";
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

function StatusBadge({ data }: { data: IntegrationCardData }) {
  if (!data.configured) return <Badge variant="secondary">Not configured</Badge>;
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

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never synced";
  return `Last sync ${new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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
            Create an incoming webhook for the target channel (channel options → Connectors or
            Workflows) and paste its URL here. A test message verifies it.
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

export function IntegrationCard({ data }: { data: IntegrationCardData }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglingCalendar, setTogglingCalendar] = useState(false);

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

  const connection = data.connection;
  const daysLeft = consentDaysLeft(connection?.consentExpiresAt ?? null);
  const consentExpiring =
    connection?.status === "CONNECTED" &&
    daysLeft !== null &&
    daysLeft >= 0 &&
    daysLeft <= CONSENT_WARNING_DAYS;
  const rateLimitLabel = rateLimitedUntilLabel(connection?.rateLimitedUntil ?? null);
  const pickerCountry = data.bankPickerCountry ?? "GB";

  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{data.name}</CardTitle>
          <StatusBadge data={data} />
        </div>
        <CardDescription>{data.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {data.capabilities.map((capability) => (
            <Badge key={capability} variant="outline" className="font-normal">
              {CAPABILITY_LABELS[capability] ?? capability}
            </Badge>
          ))}
        </div>

        {!data.configured ? (
          <div className="text-muted-foreground space-y-1">
            <p>Set these environment variables to enable this provider:</p>
            <ul className="space-y-0.5">
              {data.missingEnvVars.map((envVar) => (
                <li key={envVar}>
                  <code className="bg-muted rounded px-1 py-0.5 text-xs">{envVar}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {connection ? (
          <div className="space-y-1.5">
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
                  Bank consent expires {daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}{" "}
                  — renew it to keep syncing without interruption.
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
            {data.id === "google-calendar" ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <Label htmlFor="calendar-toggle" className="text-muted-foreground font-normal">
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
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {data.configured && !connection ? (
          data.flow === "plaid" ? (
            <PlaidConnectButton />
          ) : data.flow === "webhook" ? (
            <WebhookConnectDialog data={data} />
          ) : data.id === "gocardless" ? (
            <GoCardlessConnectButton defaultCountry={pickerCountry} />
          ) : (
            <Button size="sm" asChild>
              <a href={`/api/integrations/${data.id}/connect`}>
                <PlugIcon className="size-4" />
                Connect
              </a>
            </Button>
          )
        ) : null}

        {connection?.status === "EXPIRED" && data.configured ? (
          data.flow === "plaid" ? (
            <PlaidConnectButton />
          ) : data.id === "gocardless" ? (
            <GoCardlessConnectButton defaultCountry={pickerCountry} variant="reconnect" />
          ) : data.flow === "oauth2" || data.flow === "redirect" ? (
            <Button size="sm" asChild>
              <a href={`/api/integrations/${data.id}/connect`}>
                <PlugIcon className="size-4" />
                Reconnect
              </a>
            </Button>
          ) : null
        ) : null}

        {consentExpiring && data.configured && data.id === "gocardless" ? (
          <GoCardlessConnectButton defaultCountry={pickerCountry} variant="renew" />
        ) : null}

        {connection && data.syncable && connection.status !== "EXPIRED" ? (
          <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing}>
            {syncing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Sync now
          </Button>
        ) : null}

        {connection ? (
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
        ) : null}
      </CardFooter>
    </Card>
  );
}
