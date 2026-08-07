import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BotIcon } from "lucide-react";

import { HelpChat, type HelpMessageItem } from "@/components/help/help-chat";
import { PageHeading } from "@/components/ui/page-heading";
import { DEFAULT_EDITION } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionForWorkspaceType } from "@/lib/workspace/editions";

export const metadata: Metadata = {
  title: "Help & support",
};

export default async function HelpPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const [recent, ctx] = await Promise.all([
    prisma.helpMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, role: true, content: true },
    }),
    getWorkspaceContext(),
  ]);
  const messages: HelpMessageItem[] = recent.reverse();
  const edition = ctx ? editionForWorkspaceType(ctx.workspace.type) : DEFAULT_EDITION;

  return (
    <div className="flex min-h-[28rem] flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <PageHeading>Help & support</PageHeading>
          <p className="text-muted-foreground text-sm">
            How to do anything in Ballast, step by step.
          </p>
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <BotIcon className="size-4" />
          Questions about your numbers? Ask the{" "}
          <Link href="/copilot" className="text-primary underline underline-offset-2">
            Finance Copilot
          </Link>
        </p>
      </div>

      <div className="bg-card min-h-0 flex-1 rounded-xl border border-border/60 shadow-xs">
        <HelpChat initialMessages={messages} edition={edition} />
      </div>
    </div>
  );
}
