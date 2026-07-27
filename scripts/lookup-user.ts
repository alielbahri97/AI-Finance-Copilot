#!/usr/bin/env node
/** Look up a profile by email and print id + email for seeding. */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/lookup-user.ts <email>");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function run() {
  const profile = await prisma.profile.findFirst({
    where: { email },
    select: { id: true, email: true, fullName: true },
  });

  if (!profile) {
    console.error(`No profile found for ${email}`);
    process.exit(1);
  }

  console.log(JSON.stringify(profile));
  await prisma.$disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
