import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Forgot password",
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we will send you a link to reset your password
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
      <CardFooter className="justify-center text-sm">
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
