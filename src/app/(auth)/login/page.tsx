import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Sign in",
  description: `Sign in to your ${BRAND.name} account to manage your finances.`,
};

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your {BRAND.name} account</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <LoginForm />
        </Suspense>
      </CardContent>
      <CardFooter className="justify-center text-sm">
        <span className="text-muted-foreground">
          No account yet?{" "}
          <Link href="/signup" className="text-foreground font-medium underline-offset-4 hover:underline">
            Create one
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
