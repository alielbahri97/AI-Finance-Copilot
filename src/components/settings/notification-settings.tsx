"use client";

import { useState } from "react";
import { BellRingIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferenceDto } from "@/lib/notifications/preferences";

interface NotificationSettingsProps {
  initial: NotificationPreferenceDto;
  emailConfigured: boolean;
  pushConfigured: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function NotificationSettings({
  initial,
  emailConfigured,
  pushConfigured,
}: NotificationSettingsProps) {
  const [prefs, setPrefs] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [isPushBusy, setIsPushBusy] = useState(false);

  function set<K extends keyof NotificationPreferenceDto>(
    key: K,
    value: NotificationPreferenceDto[K]
  ) {
    setPrefs((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setIsSaving(true);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not save preferences");
      }
      toast.success("Notification preferences saved");
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function enablePushOnDevice() {
    setIsPushBusy(true);
    try {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("Push is not configured on the server (VAPID keys missing)");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support push notifications");
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was denied");

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      const response = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("Could not register the subscription");

      set("channelPush", true);
      toast.success("Push enabled on this device");
    } catch (error) {
      toast.error("Could not enable push", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsPushBusy(false);
    }
  }

  async function disablePushOnDevice() {
    setIsPushBusy(true);
    try {
      const registration = await navigator.serviceWorker?.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      toast.success("Push disabled on this device");
    } catch {
      toast.error("Could not disable push on this device");
    } finally {
      setIsPushBusy(false);
    }
  }

  const row = "flex items-center justify-between gap-4";
  const rowText = "space-y-0.5";
  const rowTitle = "text-sm font-medium";
  const rowHint = "text-muted-foreground text-xs";

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Summaries
        </p>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Daily summary</p>
            <p className={rowHint}>An AI digest of the last 24 hours, every morning</p>
          </div>
          <Switch
            checked={prefs.dailySummary}
            onCheckedChange={(value) => set("dailySummary", value)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Weekly summary</p>
            <p className={rowHint}>Your week in review, every Monday</p>
          </div>
          <Switch
            checked={prefs.weeklySummary}
            onCheckedChange={(value) => set("weeklySummary", value)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Monthly summary</p>
            <p className={rowHint}>A monthly digest on the 1st</p>
          </div>
          <Switch
            checked={prefs.monthlySummary}
            onCheckedChange={(value) => set("monthlySummary", value)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Alerts
        </p>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Large transactions</p>
            <p className={rowHint}>
              When a transaction exceeds your threshold or is far above your usual spending
            </p>
          </div>
          <Switch
            checked={prefs.largeTransaction}
            onCheckedChange={(value) => set("largeTransaction", value)}
          />
        </div>
        {prefs.largeTransaction && (
          <div className="grid gap-1.5 pl-0 sm:max-w-60">
            <Label htmlFor="nt-threshold">Alert threshold amount</Label>
            <Input
              id="nt-threshold"
              type="number"
              min={0}
              step="0.01"
              value={prefs.largeTransactionThreshold}
              onChange={(event) =>
                set("largeTransactionThreshold", Number(event.target.value) || 0)
              }
            />
          </div>
        )}
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Low cash warnings</p>
            <p className={rowHint}>
              When your balance is below the floor, or forecast to drop below it
            </p>
          </div>
          <Switch checked={prefs.lowCash} onCheckedChange={(value) => set("lowCash", value)} />
        </div>
        {prefs.lowCash && (
          <div className="grid gap-4 sm:grid-cols-2 sm:max-w-lg">
            <div className="grid gap-1.5">
              <Label htmlFor="nt-floor">Cash floor</Label>
              <Input
                id="nt-floor"
                type="number"
                min={0}
                step="0.01"
                value={prefs.lowCashFloor}
                onChange={(event) => set("lowCashFloor", Number(event.target.value) || 0)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-horizon">Forecast horizon (days)</Label>
              <Input
                id="nt-horizon"
                type="number"
                min={1}
                max={365}
                value={prefs.lowCashHorizonDays}
                onChange={(event) =>
                  set("lowCashHorizonDays", Math.max(1, Math.round(Number(event.target.value) || 1)))
                }
              />
            </div>
          </div>
        )}
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Invoice reminders</p>
            <p className={rowHint}>Daily reminder while invoices are due soon or overdue</p>
          </div>
          <Switch
            checked={prefs.invoiceReminders}
            onCheckedChange={(value) => set("invoiceReminders", value)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Channels
        </p>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>In-app</p>
            <p className={rowHint}>The bell in the header — always available</p>
          </div>
          <Switch
            checked={prefs.channelInApp}
            onCheckedChange={(value) => set("channelInApp", value)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Email</p>
            <p className={rowHint}>
              {emailConfigured
                ? "Delivered via Resend to your account email"
                : "Not configured on the server (RESEND_API_KEY) — sends are skipped"}
            </p>
          </div>
          <Switch
            checked={prefs.channelEmail}
            onCheckedChange={(value) => set("channelEmail", value)}
          />
        </div>
        <div className={row}>
          <div className={rowText}>
            <p className={rowTitle}>Push</p>
            <p className={rowHint}>
              {pushConfigured
                ? "Browser notifications, even when the app is closed"
                : "Not configured on the server (VAPID keys) — sends are skipped"}
            </p>
          </div>
          <Switch
            checked={prefs.channelPush}
            onCheckedChange={(value) => set("channelPush", value)}
          />
        </div>
        {prefs.channelPush && pushConfigured && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPushBusy}
              onClick={() => void enablePushOnDevice()}
            >
              {isPushBusy ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <BellRingIcon className="size-4" />
              )}
              Enable on this device
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPushBusy}
              onClick={() => void disablePushOnDevice()}
            >
              Disable on this device
            </Button>
          </div>
        )}
      </div>

      <div>
        <Button onClick={() => void save()} disabled={isSaving}>
          {isSaving && <Loader2Icon className="size-4 animate-spin" />}
          Save preferences
        </Button>
      </div>
    </div>
  );
}
