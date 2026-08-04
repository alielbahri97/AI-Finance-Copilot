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
  PencilIcon,
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
import { formatCurrency } from "@/lib/utils";

import { GoCardlessConnectButton } from "./gocardless-connect";
import { PlaidConnectButton } from "./plaid-connect";
import { getProviderGuide } from "./provider-guide";
import { ProviderIcon } from "./provider-icons";
import { CAPABILITY_LABELS, type ConnectionData, type IntegrationCardData } from "./types";

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

function ConnectionStatusBadge({ status }: { status: ConnectionData["status"] }) {
  switch (status) {
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

export function StatusBadge({ data }: { data: IntegrationCardData }) {
  if (!data.configured) return <Badge variant="secondary">Needs setup</Badge>;
  if (data.connections.length === 0) return <Badge variant="outline">Available</Badge>;
  if (data.connections.length > 1) {
    return (
      <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        {data.connections.length} connected
      </Badge>
    );
  }
  return <ConnectionStatusBadge status={data.connections[0].status} />;
}

function formatMoney(amount: number, currency: string | null, fallback: string): string {
  return formatCurrency(amount, currency ?? fallback);
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

function ConnectAction({
  data,
  reconnect,
  another,
}: {
  data: IntegrationCardData;
  reconnect?: boolean;
  /** An extra connection alongside the existing ones. */
  another?: boolean;
}) {
  if (data.flow === "plaid") return <PlaidConnectButton another={another} />;
  if (data.flow === "webhook") return <WebhookConnectDialog data={data} />;
  if (data.id === "gocardless") {
    return (
      <GoCardlessConnectButton
        defaultCountry={data.bankPickerCountry ?? "GB"}
        variant={another ? "another" : reconnect ? "reconnect" : "connect"}
      />
    );
  }
  const href = `/api/integrations/${data.id}/connect${another ? "?intent=add" : ""}`;
  return (
    <Button size="sm" variant={another ? "outline" : "default"} asChild>
      <a href={href}>
        <PlugIcon className="size-4" />
        {another ? "Connect another" : reconnect ? "Reconnect" : "Connect"}
      </a>
    </Button>
  );
}

function ConnectionLogo({ connection, providerId }: { connection: ConnectionData; providerId: string }) {
  if (!connection.institutionLogo) {
    return <ProviderIcon providerId={providerId} className="size-8 shrink-0" />;
  }
  return (
    // Bank logos come from the provider's CDN; next/image can't allowlist
    // arbitrary institution hosts.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={connection.institutionLogo}
      alt=""
      className="size-8 shrink-0 rounded-md object-contain"
      loading="lazy"
    />
  );
}

/** One connection row: its own status, sync, rename, disconnect and accounts. */
function ConnectionRow({ data, connection }: { data: IntegrationCardData; connection: ConnectionData }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(connection.displayName ?? "");
  const [renaming, setRenaming] = useState(false);
  const [togglingCalendar, setTogglingCalendar] = useState(false);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);

  const daysLeft = consentDaysLeft(connection.consentExpiresAt);
  const consentExpiring =
    connection.status === "CONNECTED" &&
    daysLeft !== null &&
    daysLeft >= 0 &&
    daysLeft <= CONSENT_WARNING_DAYS;
  const rateLimitLabel = rateLimitedUntilLabel(connection.rateLimitedUntil);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`/api/integrations/${data.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id }),
      });
      const body = (await response.json()) as {
        error?: string;
        stats?: Record<string, number>;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed");
      const summary = Object.entries(body.stats ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      toast.success(`${connection.title} synced${summary ? ` (${summary})` : ""}`);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not disconnect");
      toast.success(`${connection.title} disconnected`);
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const patchOptions = async (body: Record<string, unknown>, success: string) => {
    const response = await fetch(`/api/integrations/${data.id}/options`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: connection.id, ...body }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error ?? "Could not update options");
    }
    toast.success(success);
    router.refresh();
  };

  const rename = async () => {
    setRenaming(true);
    try {
      const trimmed = nameDraft.trim();
      await patchOptions({ displayName: trimmed || null }, trimmed ? "Renamed" : "Name cleared");
      setRenameOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename");
    } finally {
      setRenaming(false);
    }
  };

  const toggleAccount = async (accountId: string, includeInTotals: boolean) => {
    setPendingAccountId(accountId);
    try {
      await patchOptions(
        { account: { id: accountId, includeInTotals } },
        includeInTotals ? "Account counted in totals" : "Account excluded from totals"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the account");
    } finally {
      setPendingAccountId(null);
    }
  };

  const toggleCalendar = async (enabled: boolean) => {
    setTogglingCalendar(true);
    try {
      await patchOptions(
        { calendarEnabled: enabled },
        enabled ? "Calendar events enabled" : "Calendar events disabled"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update options");
    } finally {
      setTogglingCalendar(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <ConnectionLogo connection={connection} providerId={data.id} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{connection.title}</p>
            <ConnectionStatusBadge status={connection.status} />
          </div>
          <div className="text-muted-foreground space-y-1 text-xs">
            {connection.accounts.length > 0 ? (
              <p>
                {connection.accounts.length} account{connection.accounts.length === 1 ? "" : "s"}
                {connection.includedBalance !== null
                  ? ` · ${formatMoney(connection.includedBalance, connection.balanceCurrency, data.currency)} counted`
                  : ""}
              </p>
            ) : connection.accountLabel ? (
              <p className="truncate">{connection.accountLabel}</p>
            ) : null}
            {data.syncable ? <p>{formatLastSync(connection.lastSyncAt)}</p> : null}
            {connection.consentExpiresAt && !consentExpiring ? (
              <p>
                Consent valid until{" "}
                {new Date(connection.consentExpiresAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {consentExpiring ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Bank consent expires{" "}
            {daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} — renew it
            to keep syncing without interruption.
          </span>
        </p>
      ) : null}
      {rateLimitLabel ? (
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <HourglassIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Your bank&apos;s daily data limit was reached — syncing resumes automatically after{" "}
            {rateLimitLabel}.
          </span>
        </p>
      ) : null}
      {connection.lastError ? (
        <p className="text-destructive flex items-start gap-1.5 text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-3">
            {connection.status === "EXPIRED"
              ? "Access expired — reconnect to resume syncing. Your imported data is unaffected."
              : connection.lastError}
          </span>
        </p>
      ) : null}

      {connection.accounts.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {connection.accounts.map((account) => (
            <li key={account.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{account.label}</p>
                <p className="text-muted-foreground text-xs">
                  {account.balance !== null
                    ? formatMoney(account.balance, account.currency, data.currency)
                    : "No balance yet"}
                </p>
              </div>
              <Label
                htmlFor={`include-${account.id}`}
                className="text-muted-foreground text-xs font-normal"
              >
                In totals
              </Label>
              <Switch
                id={`include-${account.id}`}
                checked={account.includeInTotals}
                onCheckedChange={(checked) => toggleAccount(account.id, checked)}
                disabled={pendingAccountId === account.id}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {data.id === "google-calendar" ? (
        <div className="flex items-center justify-between gap-2 rounded-md border p-3">
          <Label htmlFor={`calendar-${connection.id}`} className="text-sm font-normal">
            Create calendar events for upcoming bills
          </Label>
          <Switch
            id={`calendar-${connection.id}`}
            checked={connection.calendarEnabled}
            onCheckedChange={toggleCalendar}
            disabled={togglingCalendar}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {connection.status === "EXPIRED" ? <ConnectAction data={data} reconnect /> : null}
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

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground">
              <PencilIcon className="size-4" />
              Rename
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename connection</DialogTitle>
              <DialogDescription>
                Give this connection a name you recognise, e.g. &quot;ING current&quot;. Leave it
                empty to use the bank&apos;s own name.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={`rename-${connection.id}`}>Name</Label>
              <Input
                id={`rename-${connection.id}`}
                value={nameDraft}
                maxLength={60}
                placeholder={connection.institutionName ?? data.name}
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button onClick={rename} disabled={renaming}>
                {renaming ? <Loader2Icon className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground">
              <UnplugIcon className="size-4" />
              Disconnect
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disconnect {connection.title}?</DialogTitle>
              <DialogDescription>
                Syncing stops for this connection only — your other connections keep working.
                Transactions already imported stay in your workspace, and their accounts stop
                counting towards your cash total.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
                Keep it
              </Button>
              <Button variant="destructive" size="sm" onClick={disconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2Icon className="size-4 animate-spin" /> : null}
                Disconnect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function IntegrationDetail({
  data,
  locked,
}: {
  data: IntegrationCardData;
  locked: boolean;
}) {
  const guide = getProviderGuide(data.id);
  const connections = data.connections;

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
        ) : connections.length === 0 ? (
          <Section title="How to connect" icon={<PlugIcon className="size-4" />}>
            <Steps steps={guide.userSteps} />
            <div className="pt-2">
              <ConnectAction data={data} />
            </div>
          </Section>
        ) : (
          <Section
            title={connections.length > 1 ? `Connections (${connections.length})` : "Connection"}
            icon={<PlugIcon className="size-4" />}
          >
            <div className="space-y-3">
              {connections.map((connection) => (
                <ConnectionRow key={connection.id} data={data} connection={connection} />
              ))}
              {data.multiInstance ? (
                <div className="pt-1">
                  <ConnectAction data={data} another />
                </div>
              ) : null}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
