"use client";

import { useCallback, useEffect, useState } from "react";
import { FingerprintIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  describePasskeyError,
  detectPasskeySupport,
  passkeyRegisterLabel,
  type PasskeyUiMode,
} from "@/lib/auth/passkeys";
import { createClient } from "@/lib/supabase/client";

type PasskeyRow = {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
};

function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PasskeySettings() {
  const [mode, setMode] = useState<PasskeyUiMode>("hidden");
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.passkey.list();
      if (error) {
        setLoadError(describePasskeyError(error) ?? error.message);
        setPasskeys([]);
        return;
      }
      setPasskeys(data ?? []);
    } catch (error) {
      setLoadError(describePasskeyError(error) ?? "Could not load passkeys.");
      setPasskeys([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const support = await detectPasskeySupport();
      if (cancelled) return;
      setMode(support.mode);
      if (support.mode === "hidden") {
        setIsLoading(false);
        return;
      }
      try {
        await refresh();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function registerPasskey() {
    setIsRegistering(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.registerPasskey();
      if (error) {
        const message = describePasskeyError(error);
        if (message) toast.error("Could not enable passkey", { description: message });
        return;
      }
      toast.success("Passkey enabled", {
        description: "You can sign in with Face ID, fingerprint, or your device passkey next time.",
      });
      await refresh();
    } catch (error) {
      const message = describePasskeyError(error);
      if (message) toast.error("Could not enable passkey", { description: message });
    } finally {
      setIsRegistering(false);
    }
  }

  async function removePasskey(id: string) {
    setBusyId(id);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
      if (error) {
        const message = describePasskeyError(error);
        if (message) toast.error("Could not remove passkey", { description: message });
        return;
      }
      toast.success("Passkey removed");
      setPasskeys((current) => current.filter((row) => row.id !== id));
    } catch (error) {
      const message = describePasskeyError(error);
      if (message) toast.error("Could not remove passkey", { description: message });
    } finally {
      setBusyId(null);
    }
  }

  if (mode === "hidden") {
    return (
      <p className="text-muted-foreground text-sm">
        Passkeys need a secure browser context (HTTPS or localhost) and a device that
        supports WebAuthn. This browser cannot register Face ID, fingerprint, or a
        security-key passkey right now — password sign-in still works.
      </p>
    );
  }

  const registerLabel = passkeyRegisterLabel(mode);

  return (
    <div className="grid max-w-lg gap-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Biometric / passkey login</p>
        <p className="text-muted-foreground text-sm">
          Register this device so you can sign in with Face ID, fingerprint, Touch ID,
          or Windows Hello. Your password stays as a fallback — nothing sensitive is
          stored in the browser beyond the platform authenticator.
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          Checking passkeys…
        </p>
      ) : null}

      {loadError && !isLoading ? (
        <p className="text-destructive text-sm">{loadError}</p>
      ) : null}

      {!isLoading && passkeys.length > 0 ? (
        <ul className="divide-border divide-y rounded-md border">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {passkey.friendly_name?.trim() || "Passkey"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Added {formatWhen(passkey.created_at)}
                  {passkey.last_used_at
                    ? ` · Last used ${formatWhen(passkey.last_used_at)}`
                    : null}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                disabled={busyId === passkey.id}
                aria-label={`Remove ${passkey.friendly_name?.trim() || "passkey"}`}
                onClick={() => void removePasskey(passkey.id)}
              >
                {busyId === passkey.id ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <Trash2Icon />
                )}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {!isLoading && passkeys.length === 0 && !loadError ? (
        <p className="text-muted-foreground text-sm">No passkeys on this account yet.</p>
      ) : null}

      <div>
        <Button
          type="button"
          variant="outline"
          disabled={isRegistering || isLoading}
          onClick={() => void registerPasskey()}
        >
          {isRegistering ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <FingerprintIcon />
          )}
          {registerLabel}
        </Button>
      </div>
    </div>
  );
}
