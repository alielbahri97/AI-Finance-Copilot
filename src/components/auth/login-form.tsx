"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { PasswordInput } from "@/components/auth/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginValues } from "@/lib/validations/auth";

const REMEMBER_EMAIL_FLAG_KEY = "ballast.rememberEmail";
const LOGIN_EMAIL_KEY = "ballast.loginEmail";

/**
 * Supabase reports a wrong password and an unconfirmed address with the same
 * generic wording, which leaves the user guessing which one they are looking
 * at. These say what to do instead.
 */
function describeSignInError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "That email and password do not match an account. Check for typos, or reset your password below.";
  }
  if (normalized.includes("email not confirmed")) {
    return "This account still needs confirming. Open the link in the email we sent you, then sign in.";
  }
  return message;
}

function readStoredLoginEmail(): { remember: boolean; email: string } {
  try {
    const remember = window.localStorage.getItem(REMEMBER_EMAIL_FLAG_KEY) === "1";
    const email = window.localStorage.getItem(LOGIN_EMAIL_KEY) ?? "";
    return { remember, email: remember ? email : "" };
  } catch {
    return { remember: false, email: "" };
  }
}

function persistLoginEmail(remember: boolean, email: string) {
  try {
    if (remember) {
      window.localStorage.setItem(REMEMBER_EMAIL_FLAG_KEY, "1");
      window.localStorage.setItem(LOGIN_EMAIL_KEY, email);
    } else {
      window.localStorage.removeItem(REMEMBER_EMAIL_FLAG_KEY);
      window.localStorage.removeItem(LOGIN_EMAIL_KEY);
    }
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rememberEmail, setRememberEmail] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Prefill from localStorage after mount (SSR-safe).
  useEffect(() => {
    const stored = readStoredLoginEmail();
    setRememberEmail(stored.remember);
    if (stored.email) form.setValue("email", stored.email);
  }, [form]);

  // A toast disappears before a screen reader user reaches it and leaves the
  // form looking untouched. The alert stays, and focus lands on it.
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  async function onSubmit(values: LoginValues) {
    setIsLoading(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });

      if (error) {
        setFormError(describeSignInError(error.message));
        return;
      }

      // Only persist email (never password) after a successful sign-in.
      persistLoginEmail(rememberEmail, values.email);

      toast.success("Welcome back!");
      router.push(searchParams.get("next") ?? "/dashboard");
      router.refresh();
    } catch {
      setFormError("We could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
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
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <Link
                  href="/forgot-password"
                  className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <PasswordInput
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="remember-email"
            checked={rememberEmail}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setRememberEmail(next);
              if (!next) persistLoginEmail(false, "");
            }}
          />
          <Label htmlFor="remember-email" className="font-normal">
            Remember email
          </Label>
        </div>
        {formError ? (
          <Alert variant="destructive" ref={errorRef} tabIndex={-1} className="outline-none">
            <AlertCircleIcon />
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2Icon className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </Form>
  );
}
