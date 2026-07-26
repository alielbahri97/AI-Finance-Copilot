"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUPPORTED_CURRENCIES,
  profileSchema,
  type ProfileValues,
} from "@/lib/validations/profile";

interface ProfileFormProps {
  defaultValues: ProfileValues;
  email: string;
}

export function ProfileForm({ defaultValues, email }: ProfileFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues,
  });

  async function onSubmit(values: ProfileValues) {
    setIsSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not save profile", { description: body?.error ?? "Try again." });
        return;
      }

      toast.success("Profile updated");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-lg gap-5">
        <FormItem>
          <FormLabel>Email</FormLabel>
          <Input value={email} disabled aria-readonly />
          <FormDescription>Your email is managed through your login credentials.</FormDescription>
        </FormItem>
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
          name="currency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred currency</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose currency" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Used to format amounts across the app.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div>
          <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>
    </Form>
  );
}
