"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, MailCheckIcon } from "lucide-react";
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

export function SignupForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
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

  async function onSubmit(values: SignupValues) {
    setIsLoading(true);
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
        toast.error("Sign up failed", { description: error.message });
        return;
      }

      setSubmittedEmail(values.email);
      toast.success("Account created", { description: "Check your inbox to confirm your email." });
    } catch {
      toast.error("Something went wrong", { description: "Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  if (submittedEmail) {
    return (
      <Alert>
        <MailCheckIcon />
        <AlertTitle>Confirm your email</AlertTitle>
        <AlertDescription>
          We sent a confirmation link to <strong>{submittedEmail}</strong>. Click it to activate
          your account, then sign in.
        </AlertDescription>
      </Alert>
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
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2Icon className="animate-spin" />}
          Create account
        </Button>
      </form>
    </Form>
  );
}
