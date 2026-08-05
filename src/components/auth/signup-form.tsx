"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, Loader2Icon, MailCheckIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { authCallbackUrl } from "@/lib/supabase/redirect";
import { signupSchema, type SignupValues } from "@/lib/validations/auth";
import {
  EDITION_METADATA_KEY,
  EDITION_PARAM,
  parseWorkspaceType,
  workspaceTypeParam,
} from "@/lib/workspace/editions";

/** Seconds Supabase makes a user wait between confirmation emails. */
const RESEND_COOLDOWN_SECONDS = 60;

export function SignupForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  // Referral attribution: /signup?ref=CODE travels via signup metadata.
  const referralCode = searchParams.get("ref");
  // Edition choice from the landing page: /signup?for=personal. It travels the
  // same way as the referral code, because signup metadata is what survives
  // the email-confirmation round trip.
  const workspaceType = parseWorkspaceType(searchParams.get(EDITION_PARAM));
  // Post-confirmation destination (e.g. back to a workspace invitation).
  // Personal skips the business onboarding wizard entirely.
  const rawNext = searchParams.get("next");
  const fallbackNext = workspaceType === "PERSONAL" ? "/dashboard" : "/onboarding";
  const next = rawNext && rawNext.startsWith("/") ? rawNext : fallbackNext;

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  // Errors and the confirmation screen both replace what the user was looking
  // at, so focus follows them; a toast alone announced nothing and vanished.
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  useEffect(() => {
    if (submittedEmail) confirmRef.current?.focus();
  }, [submittedEmail]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function onSubmit(values: SignupValues) {
    setIsLoading(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: {
            full_name: values.fullName,
            [EDITION_METADATA_KEY]: workspaceTypeParam(workspaceType),
            ...(referralCode ? { referral_code: referralCode } : {}),
          },
          emailRedirectTo: authCallbackUrl(next),
        },
      });

      if (error) {
        setFormError(error.message);
        return;
      }

      setSubmittedEmail(values.email);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success("Account created", { description: "Check your inbox to confirm your email." });
    } catch {
      setFormError("We could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function resendConfirmation(email: string) {
    setIsResending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: authCallbackUrl(next) },
      });
      if (error) {
        toast.error("Could not resend", { description: error.message });
        return;
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success("Confirmation email sent again", { description: email });
    } catch {
      toast.error("Could not resend", { description: "Check your connection and try again." });
    } finally {
      setIsResending(false);
    }
  }

  if (submittedEmail) {
    return (
      <div className="grid gap-4">
        <Alert ref={confirmRef} tabIndex={-1} className="outline-none">
          <MailCheckIcon />
          <AlertTitle>Confirm your email</AlertTitle>
          <AlertDescription>
            We sent a confirmation link to <strong>{submittedEmail}</strong>. Click it to activate
            your account, then sign in. It can take a minute to arrive — check your spam folder
            too.
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isResending || resendCooldown > 0}
            onClick={() => void resendConfirmation(submittedEmail)}
          >
            {isResending && <Loader2Icon className="animate-spin" />}
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : "Resend confirmation"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSubmittedEmail(null);
              setResendCooldown(0);
            }}
          >
            Wrong address?
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Signing up again with a corrected address creates the account there instead — the
          unconfirmed one expires on its own.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input placeholder="Ada Lovelace" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
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
            <AlertTitle>Sign up failed</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2Icon className="animate-spin" />}
          Create account
        </Button>
      </form>
    </Form>
  );
}
