"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, FingerprintIcon, Loader2Icon, LockIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PasswordInput } from "@/components/auth/password-input";
import { BallastLogo } from "@/components/brand/ballast-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import {
  describePasskeyError,
  detectPasskeySupport,
  passkeySignInLabel,
  type PasskeyUiMode,
} from "@/lib/auth/passkeys";
import { clearSessionLock } from "@/lib/auth/session-lock";
import { createClient } from "@/lib/supabase/client";

const unlockSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type UnlockValues = z.infer<typeof unlockSchema>;

function describeUnlockError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "That password is incorrect. Try again, or sign out and reset it.";
  }
  return message;
}

type SessionLockScreenProps = {
  email: string;
  userId: string;
  onUnlocked: () => void;
};

export function SessionLockScreen({ email, userId, onUnlocked }: SessionLockScreenProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [passkeyMode, setPasskeyMode] = useState<PasskeyUiMode>("hidden");
  const errorRef = useRef<HTMLDivElement>(null);
  const autoPasskeyTried = useRef(false);
  const busy = isLoading || isPasskeyLoading || isSigningOut;

  const form = useForm<UnlockValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: "" },
  });

  useEffect(() => {
    let cancelled = false;
    void detectPasskeySupport().then((support) => {
      if (!cancelled) setPasskeyMode(support.mode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  async function ensureSameUser(nextUserId: string | undefined): Promise<boolean> {
    if (nextUserId && nextUserId === userId) return true;
    setFormError("Unlock must use this account. Sign out to switch users.");
    return false;
  }

  async function onPasskeyUnlock() {
    setIsPasskeyLoading(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPasskey();
      if (error) {
        const message = describePasskeyError(error);
        if (message) setFormError(message);
        return;
      }
      if (!data.session) {
        setFormError("Passkey unlock did not create a session. Try again, or use your password.");
        return;
      }
      if (data.user?.id !== userId) {
        // Wrong account replaced the session — force a clean sign-in.
        await supabase.auth.signOut();
        clearSessionLock();
        router.push("/login");
        router.refresh();
        return;
      }
      clearSessionLock();
      onUnlocked();
    } catch (error) {
      const message = describePasskeyError(error);
      if (message) setFormError(message);
    } finally {
      setIsPasskeyLoading(false);
    }
  }

  // Revolut-style: offer biometrics immediately when the lock appears.
  useEffect(() => {
    if (passkeyMode !== "biometric" || autoPasskeyTried.current) return;
    autoPasskeyTried.current = true;
    void onPasskeyUnlock();
    // Intentionally once per lock presentation; biometric mode gates availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-prompt once
  }, [passkeyMode]);

  async function onSubmit(values: UnlockValues) {
    setIsLoading(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: values.password,
      });
      if (error) {
        setFormError(describeUnlockError(error.message));
        return;
      }
      if (!(await ensureSameUser(data.user?.id))) return;
      clearSessionLock();
      form.reset();
      onUnlocked();
    } catch {
      setFormError("We could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function onSignOut() {
    setIsSigningOut(true);
    setFormError(null);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      clearSessionLock();
      router.push("/login");
      router.refresh();
    } catch {
      setFormError("Sign out failed. Try again.");
      setIsSigningOut(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-lock-title"
      className="bg-background/95 fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 overflow-y-auto px-4 py-10 backdrop-blur-md"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,oklch(0.5_0.22_255/0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.57_0.19_255/0.14),transparent_50%)]"
      />
      <BallastLogo />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
            <LockIcon className="size-5" />
          </div>
          <h1 id="session-lock-title" className="text-xl font-semibold tracking-tight">
            Session locked
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            Confirm it&apos;s you to continue as{" "}
            <span className="text-foreground font-medium">{email}</span>
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {passkeyMode !== "hidden" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void onPasskeyUnlock()}
                >
                  {isPasskeyLoading ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <FingerprintIcon />
                  )}
                  {passkeySignInLabel(passkeyMode)}
                </Button>
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground text-xs uppercase">or</span>
                  <Separator className="flex-1" />
                </div>
              </>
            ) : null}

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="••••••••"
                      autoComplete="current-password"
                      autoFocus={passkeyMode === "hidden"}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {formError ? (
              <Alert variant="destructive" ref={errorRef} tabIndex={-1} className="outline-none">
                <AlertCircleIcon />
                <AlertTitle>Unlock failed</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {isLoading && <Loader2Icon className="animate-spin" />}
              Unlock
            </Button>
          </form>
        </Form>

        <div className="mt-6 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => void onSignOut()}
          >
            {isSigningOut && <Loader2Icon className="animate-spin" />}
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
