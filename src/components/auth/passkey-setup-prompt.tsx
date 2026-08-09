"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FingerprintIcon, Loader2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  decidePasskeyPrompt,
  readPasskeyPromptPrefs,
  writePasskeyPromptDismissed,
  writePasskeyPromptNever,
} from "@/lib/auth/passkey-prompt";
import {
  describePasskeyError,
  detectPasskeySupport,
  passkeyRegisterLabel,
  type PasskeyUiMode,
} from "@/lib/auth/passkeys";
import { createClient } from "@/lib/supabase/client";

/**
 * Non-blocking nudge to enable Face ID / passkey after first login, and
 * occasionally later when the account still has none. Prefs live in localStorage.
 */
export function PasskeySetupPrompt() {
  const pathname = usePathname();
  const checkedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Exclude<PasskeyUiMode, "hidden"> | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    // Settings already exposes registration — don't compete with that page.
    if (pathname?.startsWith("/settings")) {
      setOpen(false);
      return;
    }
    // One decision per dashboard session (layout stays mounted across routes).
    if (checkedRef.current) return;
    checkedRef.current = true;

    let cancelled = false;

    (async () => {
      const support = await detectPasskeySupport();
      if (cancelled || support.mode === "hidden" || !support.webAuthn) return;

      let passkeyCount = 0;
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.passkey.list();
        if (error) return;
        passkeyCount = data?.length ?? 0;
      } catch {
        return;
      }
      if (cancelled) return;

      const decision = decidePasskeyPrompt({
        webAuthnAvailable: true,
        passkeyCount,
        prefs: readPasskeyPromptPrefs(),
        now: Date.now(),
        random: Math.random(),
      });

      if (cancelled || !decision.show) return;

      setMode(support.mode);
      setOpen(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function softDismiss() {
    writePasskeyPromptDismissed(Date.now());
    setOpen(false);
  }

  function neverAsk() {
    writePasskeyPromptNever();
    writePasskeyPromptDismissed(Date.now());
    setOpen(false);
  }

  function onOpenChange(next: boolean) {
    if (!next) {
      softDismiss();
      return;
    }
    setOpen(true);
  }

  async function enablePasskey() {
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
      writePasskeyPromptNever();
      setOpen(false);
    } catch (error) {
      const message = describePasskeyError(error);
      if (message) toast.error("Could not enable passkey", { description: message });
    } finally {
      setIsRegistering(false);
    }
  }

  if (!mode) return null;

  const registerLabel = passkeyRegisterLabel(mode);
  const title =
    mode === "biometric" ? "Turn on Face ID / fingerprint?" : "Turn on passkey login?";
  const description =
    mode === "biometric"
      ? "Sign in faster next time with Face ID, Touch ID, or Windows Hello. Your password stays as a fallback."
      : "Register a passkey on this device for faster sign-in. Your password stays as a fallback.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="bg-primary text-primary-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            <FingerprintIcon className="size-5" aria-hidden />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            disabled={isRegistering}
            onClick={() => void enablePasskey()}
            className="w-full sm:w-full"
          >
            {isRegistering ? <Loader2Icon className="animate-spin" /> : <FingerprintIcon />}
            {registerLabel}
          </Button>
          <Button type="button" variant="outline" asChild className="w-full sm:w-full">
            <Link href="/settings#security" onClick={softDismiss}>
              Open Settings → Security
            </Link>
          </Button>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={softDismiss} className="sm:flex-1">
              Not now
            </Button>
            <Button type="button" variant="ghost" onClick={neverAsk} className="sm:flex-1">
              Don&apos;t ask again
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
