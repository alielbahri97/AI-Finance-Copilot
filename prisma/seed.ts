/**
 * Seeds demo transactions for an existing Supabase user.
 *
 * Usage:
 *   npm run db:seed -- <supabase-user-id> <email>
 *
 * Create the user first via the app's signup page (or the Supabase
 * dashboard), then pass its UUID here.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, TransactionType } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const EXPENSE_TEMPLATES: { category: string; description: string; min: number; max: number }[] = [
  { category: "Housing", description: "Monthly rent", min: 1400, max: 1400 },
  { category: "Groceries", description: "Supermarket run", min: 45, max: 160 },
  { category: "Transport", description: "Fuel and transit", min: 20, max: 90 },
  { category: "Dining", description: "Restaurants and takeout", min: 15, max: 85 },
  { category: "Entertainment", description: "Movies and events", min: 10, max: 60 },
  { category: "Utilities", description: "Electricity and internet", min: 80, max: 140 },
  { category: "Subscriptions", description: "Streaming services", min: 10, max: 35 },
  { category: "Health", description: "Pharmacy and gym", min: 20, max: 70 },
  { category: "Shopping", description: "Clothing and gear", min: 25, max: 180 },
];

function randomBetween(min: number, max: number) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

async function main() {
  const [userId, email] = process.argv.slice(2);
  if (!userId || !email) {
    console.error("Usage: npm run db:seed -- <supabase-user-id> <email>");
    process.exit(1);
  }

  await prisma.profile.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email, fullName: "Demo User" },
  });

  await prisma.transaction.deleteMany({ where: { userId } });

  const transactions: {
    userId: string;
    type: TransactionType;
    amount: number;
    category: string;
    description: string;
    date: Date;
  }[] = [];

  for (let monthOffset = 5; monthOffset >= 0; monthOffset--) {
    const base = new Date();
    base.setMonth(base.getMonth() - monthOffset);

    // Salary on the 1st of each month.
    const salaryDate = new Date(base.getFullYear(), base.getMonth(), 1);
    transactions.push({
      userId,
      type: TransactionType.INCOME,
      amount: 5200,
      category: "Salary",
      description: "Monthly salary",
      date: salaryDate,
    });

    // Occasional freelance income.
    if (monthOffset % 2 === 0) {
      transactions.push({
        userId,
        type: TransactionType.INCOME,
        amount: randomBetween(400, 1200),
        category: "Freelance",
        description: "Side project invoice",
        date: new Date(base.getFullYear(), base.getMonth(), 15),
      });
    }

    for (const template of EXPENSE_TEMPLATES) {
      const occurrences = template.category === "Housing" ? 1 : Math.ceil(Math.random() * 3);
      for (let i = 0; i < occurrences; i++) {
        transactions.push({
          userId,
          type: TransactionType.EXPENSE,
          amount: randomBetween(template.min, template.max),
          category: template.category,
          description: template.description,
          date: new Date(
            base.getFullYear(),
            base.getMonth(),
            Math.max(1, Math.ceil(Math.random() * 28))
          ),
        });
      }
    }
  }

  await prisma.transaction.createMany({ data: transactions });
  console.log(`Seeded ${transactions.length} transactions for ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
