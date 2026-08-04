import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BotIcon } from "lucide-react";

import { HelpChat, type HelpMessageItem } from "@/components/help/help-chat";
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
    <div className="flex h-[calc(100svh-8.5rem)] min-h-[28rem] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Help & support</h1>
          <p className="text-muted-foreground text-sm">
            Ask how to do anything in the app and get step-by-step instructions.
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

      <div className="bg-card min-h-0 flex-1 rounded-xl border shadow-sm">
        <HelpChat initialMessages={messages} edition={edition} />
      </div>
    </div>
  );
}
