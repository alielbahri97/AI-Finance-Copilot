"use client";

import { useEffect, useRef, useState } from "react";
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
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/validations/auth";

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  useEffect(() => {
    if (submitted) sentRef.current?.focus();
  }, [submitted]);

  async function onSubmit(values: ForgotPasswordValues) {
    setIsLoading(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: authCallbackUrl("/reset-password"),
      });

      if (error) {
        setFormError(error.message);
        return;
      }

      setSubmitted(true);
      toast.success("Reset email sent");
    } catch {
      setFormError("We could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="grid gap-4">
        <Alert ref={sentRef} tabIndex={-1} className="outline-none">
          <MailCheckIcon />
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>
            If an account exists for that email, you will receive a link to reset your password.
          </AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSubmitted(false)}>
            Wrong address?
          </Button>
        </div>
      </div>
    );
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
        {formError ? (
          <Alert variant="destructive" ref={errorRef} tabIndex={-1} className="outline-none">
            <AlertCircleIcon />
            <AlertTitle>Could not send reset email</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2Icon className="animate-spin" />}
          Send reset link
        </Button>
      </form>
    </Form>
  );
}
