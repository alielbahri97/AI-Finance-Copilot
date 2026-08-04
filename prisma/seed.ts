/**
 * Seeds a full demo dataset for an existing Supabase user.
 *
 * Usage:
 *   npm run db:seed -- <supabase-user-id> <email> [months]
 *
 * `months` defaults to 6 (matches FIRST_RUN.md). Pass `all` for 6 months explicitly.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  TransactionType,
  type AssumptionKind,
  type InvoiceDirection,
  type InvoiceStatus,
} from "../src/generated/prisma/client";
import { personalMembershipId, personalWorkspaceId } from "../src/lib/workspace/ids";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEFAULT_CATEGORIES: { name: string; type: TransactionType; color: string }[] = [
  { name: "Salary", type: "INCOME", color: "#10b981" },
  { name: "Freelance", type: "INCOME", color: "#14b8a6" },
  { name: "Investments", type: "INCOME", color: "#06b6d4" },
  { name: "Other income", type: "INCOME", color: "#64748b" },
  { name: "Housing", type: "EXPENSE", color: "#6366f1" },
  { name: "Groceries", type: "EXPENSE", color: "#f59e0b" },
  { name: "Transport", type: "EXPENSE", color: "#3b82f6" },
  { name: "Dining", type: "EXPENSE", color: "#ef4444" },
  { name: "Entertainment", type: "EXPENSE", color: "#ec4899" },
  { name: "Health", type: "EXPENSE", color: "#22c55e" },
  { name: "Shopping", type: "EXPENSE", color: "#a855f7" },
  { name: "Utilities", type: "EXPENSE", color: "#0ea5e9" },
  { name: "Travel", type: "EXPENSE", color: "#f97316" },
  { name: "Subscriptions", type: "EXPENSE", color: "#8b5cf6" },
  { name: "Education", type: "EXPENSE", color: "#84cc16" },
  { name: "Other", type: "EXPENSE", color: "#64748b" },
];

const CATEGORY_RULES: { pattern: string; category: string }[] = [
  { pattern: "netflix", category: "Subscriptions" },
  { pattern: "spotify", category: "Subscriptions" },
  { pattern: "albert heijn", category: "Groceries" },
  { pattern: "jumbo", category: "Groceries" },
  { pattern: "lidl", category: "Groceries" },
  { pattern: "shell", category: "Transport" },
  { pattern: "ns reizigers", category: "Transport" },
  { pattern: "rent", category: "Housing" },
  { pattern: "salary", category: "Salary" },
  { pattern: "freelance", category: "Freelance" },
];

/** Fixed monthly expenses for consistent recurring patterns in forecast. */
const MONTHLY_FIXED: {
  day: number;
  category: string;
  description: string;
  counterparty: string;
  amount: number;
}[] = [
  { day: 1, category: "Salary", description: "Monthly salary", counterparty: "TechFlow BV", amount: 4200 },
  { day: 2, category: "Housing", description: "Monthly rent", counterparty: "Amsterdam Housing Co", amount: 1450 },
  { day: 7, category: "Subscriptions", description: "Netflix", counterparty: "Netflix", amount: 15.99 },
  { day: 14, category: "Subscriptions", description: "Spotify Premium", counterparty: "Spotify", amount: 10.99 },
  { day: 18, category: "Utilities", description: "Internet bill", counterparty: "Ziggo", amount: 52.5 },
  { day: 20, category: "Health", description: "Gym membership", counterparty: "Basic-Fit", amount: 24.99 },
];

const VARIABLE_EXPENSES: {
  category: string;
  descriptions: string[];
  counterparties: string[];
  min: number;
  max: number;
  count: number;
}[] = [
  {
    category: "Groceries",
    descriptions: ["Grocery shopping", "Supermarket run"],
    counterparties: ["Albert Heijn", "Jumbo", "Lidl"],
    min: 45,
    max: 110,
    count: 3,
  },
  {
    category: "Dining",
    descriptions: ["Restaurant dinner", "Lunch out"],
    counterparties: ["De Kas", "Wagamama", "Luigi's"],
    min: 18,
    max: 85,
    count: 2,
  },
  {
    category: "Transport",
    descriptions: ["Fuel", "Public transport"],
    counterparties: ["Shell", "NS Reizigers"],
    min: 22,
    max: 75,
    count: 2,
  },
  {
    category: "Utilities",
    descriptions: ["Electricity and gas"],
    counterparties: ["Vattenfall"],
    min: 85,
    max: 120,
    count: 1,
  },
  {
    category: "Shopping",
    descriptions: ["Online order", "Clothing"],
    counterparties: ["Amazon EU", "Bol.com"],
    min: 25,
    max: 140,
    count: 1,
  },
];

function rowHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function parseMonths(arg: string | undefined): number {
  if (!arg || arg === "all") return 6;
  const n = Number(arg);
  return Math.min(12, Math.max(1, Number.isFinite(n) ? n : 6));
}

function atDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

async function main() {
  const [userId, email, monthsArg] = process.argv.slice(2);
  const months = parseMonths(monthsArg);
  if (!userId || !email) {
    console.error("Usage: npm run db:seed -- <supabase-user-id> <email> [months|all]");
    process.exit(1);
  }

  const displayName =
    email
      .split("@")[0]
      ?.split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ?? "Demo User";

  await prisma.profile.upsert({
    where: { id: userId },
    update: { fullName: displayName, currency: "USD" },
    create: { id: userId, email, fullName: displayName, currency: "USD" },
  });

  // Personal workspace + OWNER membership (mirrors getOrCreateProfile).
  const workspaceId = personalWorkspaceId(userId);
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: { currency: "USD" },
    create: { id: workspaceId, name: `${displayName}'s workspace`, currency: "USD" },
  });
  await prisma.workspaceMember.upsert({
    where: { id: personalMembershipId(userId) },
    update: { role: "OWNER" },
    create: { id: personalMembershipId(userId), workspaceId, userId, role: "OWNER" },
  });

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      workspaceId,
      userId,
      isDefault: true,
    })),
    skipDuplicates: true,
  });
  const categories = await prisma.category.findMany({ where: { workspaceId } });
  const categoryIdByName = new Map(categories.map((category) => [category.name, category.id]));

  // Wipe demo-scoped data (keep profile + categories).
  await prisma.chatMessage.deleteMany({ where: { userId } });
  await prisma.conversation.deleteMany({ where: { workspaceId } });
  await prisma.invoiceLineItem.deleteMany({
    where: { invoice: { workspaceId } },
  });
  await prisma.invoice.deleteMany({ where: { workspaceId } });
  await prisma.assumption.deleteMany({ where: { workspaceId } });
  await prisma.categoryRule.deleteMany({ where: { workspaceId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.budget.deleteMany({ where: { workspaceId } });
  await prisma.transaction.deleteMany({ where: { workspaceId } });
  await prisma.importBatch.deleteMany({ where: { workspaceId } });

  // Category rules
  await prisma.categoryRule.createMany({
    data: CATEGORY_RULES.map((rule) => ({
      workspaceId,
      userId,
      pattern: rule.pattern,
      categoryId: categoryIdByName.get(rule.category)!,
    })),
    skipDuplicates: true,
  });

  // Transactions — 6 months of realistic history with running balance.
  const now = new Date();
  const transactions: {
    workspaceId: string;
    userId: string;
    type: TransactionType;
    amount: number;
    categoryId: string | null;
    description: string;
    counterparty: string | null;
    date: Date;
    balance: number | null;
    hash: string | null;
    importBatchId: string | null;
  }[] = [];

  let runningBalance = 3200;

  for (let monthOffset = months - 1; monthOffset >= 0; monthOffset--) {
    const base = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const year = base.getFullYear();
    const month = base.getMonth();

    for (const fixed of MONTHLY_FIXED) {
      const isIncome = fixed.category === "Salary";
      runningBalance += isIncome ? fixed.amount : -fixed.amount;
      transactions.push({
        workspaceId,
        userId,
        type: isIncome ? "INCOME" : "EXPENSE",
        amount: fixed.amount,
        categoryId: categoryIdByName.get(fixed.category) ?? null,
        description: fixed.description,
        counterparty: fixed.counterparty,
        date: atDay(year, month, fixed.day),
        balance: runningBalance,
        hash: null,
        importBatchId: null,
      });
    }

    // Freelance every other month
    if (monthOffset % 2 === 0) {
      const amount = 650 + monthOffset * 100;
      runningBalance += amount;
      transactions.push({
        workspaceId,
        userId,
        type: "INCOME",
        amount,
        categoryId: categoryIdByName.get("Freelance") ?? null,
        description: "Freelance invoice payment",
        counterparty: "Bright Design Studio",
        date: atDay(year, month, 15),
        balance: runningBalance,
        hash: null,
        importBatchId: null,
      });
    }

    for (const variable of VARIABLE_EXPENSES) {
      for (let i = 0; i < variable.count; i++) {
        const amount =
          Math.round((variable.min + ((i + monthOffset) % 3) * ((variable.max - variable.min) / 2)) * 100) /
          100;
        const description = variable.descriptions[i % variable.descriptions.length]!;
        const counterparty = variable.counterparties[i % variable.counterparties.length]!;
        const day = 3 + i * 5 + (monthOffset % 2);
        runningBalance -= amount;
        transactions.push({
          workspaceId,
          userId,
          type: "EXPENSE",
          amount,
          categoryId: categoryIdByName.get(variable.category) ?? null,
          description,
          counterparty,
          date: atDay(year, month, Math.min(28, day)),
          balance: runningBalance,
          hash: null,
          importBatchId: null,
        });
      }
    }
  }

  // One import batch for the most recent month (shows on Import history).
  const importBatch = await prisma.importBatch.create({
    data: { workspaceId, userId, fileName: "demo-bank-export-jul-2026.csv" },
  });
  const recentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const recentImports = transactions
    .filter((tx) => tx.date >= recentMonth)
    .slice(0, 8)
    .map((tx, index) => {
      const base = [
        tx.date.toISOString().slice(0, 10),
        tx.type,
        tx.amount.toFixed(2),
        tx.description.toLowerCase(),
        (tx.counterparty ?? "").toLowerCase(),
      ].join("|");
      return {
        ...tx,
        importBatchId: importBatch.id,
        hash: rowHash(`${base}|#${index}`),
      };
    });
  for (const tx of recentImports) {
    const idx = transactions.findIndex(
      (row) => row.date.getTime() === tx.date.getTime() && row.description === tx.description
    );
    if (idx >= 0) transactions[idx] = tx;
  }

  await prisma.transaction.createMany({ data: transactions });

  // Forecast assumptions
  const assumptions: {
    workspaceId: string;
    userId: string;
    kind: AssumptionKind;
    type: TransactionType;
    label: string;
    amount?: number;
    percent?: number;
    date?: Date;
    startDate?: Date;
    endDate?: Date;
  }[] = [
    {
      workspaceId,
      userId,
      kind: "ONE_OFF",
      type: "EXPENSE",
      label: "Laptop upgrade",
      amount: 1200,
      date: atDay(now.getFullYear(), now.getMonth() + 1, 10),
    },
    {
      workspaceId,
      userId,
      kind: "RECURRING",
      type: "INCOME",
      label: "Consulting retainer",
      amount: 500,
      startDate: atDay(now.getFullYear(), now.getMonth(), 1),
      endDate: atDay(now.getFullYear(), now.getMonth() + 5, 28),
    },
    {
      workspaceId,
      userId,
      kind: "PERCENT_GROWTH",
      type: "EXPENSE",
      label: "Inflation on groceries",
      percent: 2.5,
      startDate: atDay(now.getFullYear(), now.getMonth(), 1),
    },
  ];
  await prisma.assumption.createMany({ data: assumptions });

  // Monthly budgets for top expense categories
  const budgetMonth = now.getMonth() + 1;
  const budgetYear = now.getFullYear();
  await prisma.budget.createMany({
    data: [
      { workspaceId, userId, category: "Groceries", limit: 400, month: budgetMonth, year: budgetYear },
      { workspaceId, userId, category: "Dining", limit: 250, month: budgetMonth, year: budgetYear },
      { workspaceId, userId, category: "Transport", limit: 200, month: budgetMonth, year: budgetYear },
      { workspaceId, userId, category: "Shopping", limit: 300, month: budgetMonth, year: budgetYear },
    ],
    skipDuplicates: true,
  });

  // Invoices — mix of payable/receivable and statuses
  const invoiceDefs: {
    vendor: string;
    invoiceNumber: string;
    total: number;
    direction: InvoiceDirection;
    status: InvoiceStatus;
    dueOffsetDays: number;
    invoiceOffsetDays: number;
    lineItems: { description: string; quantity: number; unitPrice: number }[];
  }[] = [
    {
      vendor: "Vattenfall",
      invoiceNumber: "VF-2026-1842",
      total: 104.75,
      direction: "PAYABLE",
      status: "UNPAID",
      dueOffsetDays: 5,
      invoiceOffsetDays: -12,
      lineItems: [{ description: "Electricity June 2026", quantity: 1, unitPrice: 104.75 }],
    },
    {
      vendor: "Office Supplies NL",
      invoiceNumber: "OS-4410",
      total: 248.5,
      direction: "PAYABLE",
      status: "UNPAID",
      dueOffsetDays: -3,
      invoiceOffsetDays: -20,
      lineItems: [
        { description: "Printer cartridges", quantity: 2, unitPrice: 49.5 },
        { description: "Desk organizer", quantity: 1, unitPrice: 149.5 },
      ],
    },
    {
      vendor: "Bright Design Studio",
      invoiceNumber: "INV-2026-089",
      total: 920,
      direction: "RECEIVABLE",
      status: "UNPAID",
      dueOffsetDays: 14,
      invoiceOffsetDays: -5,
      lineItems: [{ description: "Website redesign — milestone 2", quantity: 1, unitPrice: 920 }],
    },
    {
      vendor: "Ziggo",
      invoiceNumber: "ZG-77201",
      total: 52.5,
      direction: "PAYABLE",
      status: "PAID",
      dueOffsetDays: -18,
      invoiceOffsetDays: -30,
      lineItems: [{ description: "Internet — July 2026", quantity: 1, unitPrice: 52.5 }],
    },
    {
      vendor: "KPN",
      invoiceNumber: "KPN-9931",
      total: 29.99,
      direction: "PAYABLE",
      status: "DRAFT",
      dueOffsetDays: 21,
      invoiceOffsetDays: -2,
      lineItems: [{ description: "Mobile plan", quantity: 1, unitPrice: 29.99 }],
    },
  ];

  for (const inv of invoiceDefs) {
    const invoiceDate = new Date(now);
    invoiceDate.setDate(invoiceDate.getDate() + inv.invoiceOffsetDays);
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + inv.dueOffsetDays);
    const subtotal = inv.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);

    await prisma.invoice.create({
      data: {
        workspaceId,
        userId,
        vendor: inv.vendor,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate,
        dueDate,
        currency: "USD",
        subtotal,
        total: inv.total,
        direction: inv.direction,
        status: inv.status,
        extractionStatus: inv.status === "DRAFT" ? "NEEDS_REVIEW" : "EXTRACTED",
        storagePath: `${userId}/demo/${inv.invoiceNumber}.pdf`,
        fileName: `${inv.invoiceNumber}.pdf`,
        mimeType: "application/pdf",
        lineItems: {
          create: inv.lineItems.map((li, sortOrder) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            total: li.quantity * li.unitPrice,
            sortOrder,
          })),
        },
      },
    });
  }

  // Notifications
  await prisma.notification.createMany({
    data: [
      {
        userId,
        type: "WEEKLY_SUMMARY",
        title: "Your week in review",
        body: "Income $4,850 · Expenses $1,942 · Net +$2,908. Groceries were your top category.",
        link: "/reports",
        readAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        userId,
        type: "INVOICE_REMINDER",
        title: "Invoice due soon",
        body: "Office Supplies NL ($248.50) is overdue. Review it on the Invoices page.",
        link: "/invoices",
      },
      {
        userId,
        type: "LARGE_TRANSACTION",
        title: "Large transaction detected",
        body: "Salary payment of $4,200.00 was recorded on the 1st.",
        link: "/transactions",
      },
    ],
  });

  await prisma.notificationPreference.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      weeklySummary: true,
      monthlySummary: true,
      largeTransaction: true,
      largeTransactionThreshold: 500,
      lowCash: true,
      lowCashFloor: 1000,
      invoiceReminders: true,
    },
  });

  // Sample copilot conversation (static — no OpenAI needed to view history)
  const conversation = await prisma.conversation.create({
    data: { workspaceId, userId, title: "Spending overview" },
  });
  await prisma.chatMessage.createMany({
    data: [
      {
        userId,
        conversationId: conversation.id,
        role: "USER",
        content: "What did I spend on groceries last month?",
      },
      {
        userId,
        conversationId: conversation.id,
        role: "ASSISTANT",
        content:
          "Based on your transactions, grocery spending last month was about **$286** across Albert Heijn, Jumbo, and Lidl. That's roughly 12% of your total expenses — in line with your $400 monthly budget.",
      },
      {
        userId,
        conversationId: conversation.id,
        role: "USER",
        content: "How is my cash runway looking?",
      },
      {
        userId,
        conversationId: conversation.id,
        role: "ASSISTANT",
        content:
          "You're cash-flow positive with a projected balance of about **$5,700** in 30 days. Recurring income (salary + freelance) comfortably covers rent and subscriptions. Your largest upcoming payable is the Vattenfall bill ($104.75).",
      },
    ],
  });

  console.log(`\nDemo data seeded for ${email} (${months} months):\n`);
  console.log(`  • ${transactions.length} transactions`);
  console.log(`  • ${CATEGORY_RULES.length} category rules`);
  console.log(`  • ${assumptions.length} forecast assumptions`);
  console.log(`  • ${invoiceDefs.length} invoices`);
  console.log(`  • 4 monthly budgets`);
  console.log(`  • 3 notifications + preferences`);
  console.log(`  • 1 copilot conversation (4 messages)`);
  console.log(`  • 1 import batch\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
