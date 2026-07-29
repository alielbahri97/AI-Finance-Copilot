"use client";

import { useState } from "react";
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
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/validations/auth";

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: authCallbackUrl("/reset-password"),
      });

      if (error) {
        toast.error("Could not send reset email", { description: error.message });
        return;
      }

      setSubmitted(true);
      toast.success("Reset email sent");
    } catch {
      toast.error("Something went wrong", { description: "Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  if (submitted) {
    return (
      <Alert>
        <MailCheckIcon />
        <AlertTitle>Check your inbox</AlertTitle>
        <AlertDescription>
          If an account exists for that email, you will receive a link to reset your password.
        </AlertDescription>
      </Alert>
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
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2Icon className="animate-spin" />}
          Send reset link
        </Button>
      </form>
    </Form>
  );
}
