import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "@/components/auth/signup-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Create account",
  description: `Create a free ${BRAND.name} account: import bank statements, forecast cash flow, and get AI insights.`,
};

export default function SignupPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Start tracking your finances in minutes</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Suspense: SignupForm reads the ?ref= search param on the client. */}
        <Suspense>
          <SignupForm />
        </Suspense>
      </CardContent>
      <CardFooter className="justify-center text-sm">
        <span className="text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
