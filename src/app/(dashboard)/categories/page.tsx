import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CategoryManager, type CategoryItem } from "@/components/categories/category-manager";
import { RulesManager, type RuleItem } from "@/components/categories/rules-manager";
import type { CategoryOption } from "@/components/transactions/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BRAND } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_transactions")) redirect("/dashboard");

  const [categories, rules] = await Promise.all([
    prisma.category.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { _count: { select: { transactions: true } } },
    }),
    prisma.categoryRule.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: { category: { select: { name: true, color: true } } },
    }),
  ]);

  const categoryItems: CategoryItem[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    type: category.type,
    color: category.color,
    isDefault: category.isDefault,
    transactionCount: category._count.transactions,
  }));

  const categoryOptions: CategoryOption[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    type: category.type,
    color: category.color,
  }));

  const ruleItems: RuleItem[] = rules.map((rule) => ({
    id: rule.id,
    pattern: rule.pattern,
    categoryId: rule.categoryId,
    categoryName: rule.category.name,
    categoryColor: rule.category.color,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
        <p className="text-muted-foreground text-sm">
          Organize your spending with categories and auto-categorization rules.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your categories</CardTitle>
            <CardDescription>
              Deleting a category keeps its transactions and marks them uncategorized.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryManager categories={categoryItems} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Auto-categorization rules</CardTitle>
            <CardDescription>
              Applied on import and when you add transactions. Matching description or
              counterparty text gets that category. Manual category changes also teach{" "}
              {BRAND.name} new rules for similar merchants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RulesManager rules={ruleItems} categories={categoryOptions} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
