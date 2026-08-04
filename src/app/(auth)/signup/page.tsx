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
import { BRAND, editionBranding } from "@/lib/branding";
import {
  EDITION_PARAM,
  editionForWorkspaceType,
  parseWorkspaceType,
  workspaceTypeParam,
} from "@/lib/workspace/editions";

export const metadata: Metadata = {
  title: "Create account",
  description: `Create a free ${BRAND.name} account: import bank statements, forecast cash flow, and get AI insights.`,
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[EDITION_PARAM];
  const workspaceType = parseWorkspaceType(Array.isArray(raw) ? raw[0] : raw);
  const edition = editionForWorkspaceType(workspaceType);
  const branding = editionBranding(edition);

  const otherType = workspaceType === "PERSONAL" ? "BUSINESS" : "PERSONAL";
  const otherBranding = editionBranding(editionForWorkspaceType(otherType));

  // Preserve the referral code and post-confirmation destination when the
  // visitor changes their mind about the edition.
  const switchParams = new URLSearchParams({ [EDITION_PARAM]: workspaceTypeParam(otherType) });
  for (const key of ["ref", "next"]) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) switchParams.set(key, single);
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardDescription className={branding.accentClassName}>{branding.name}</CardDescription>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>{branding.choiceDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Suspense: SignupForm reads the ?ref= and ?for= params on the client. */}
        <Suspense>
          <SignupForm />
        </Suspense>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-center text-sm">
        <span className="text-muted-foreground">
          {otherBranding.choiceLabel} instead?{" "}
          <Link
            href={`/signup?${switchParams.toString()}`}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Switch to {otherBranding.name}
          </Link>
        </span>
        <span className="text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
