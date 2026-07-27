import "server-only";

import { logger, serializeError } from "@/lib/logger";

import { randomBytes } from "node:crypto";

import { trackEvent } from "@/lib/analytics";
import { prisma } from "@/lib/prisma";

import { getOrCreateSubscription } from "./entitlements";

/** Days of Pro credit granted per converted referral. */
export const REFERRAL_REWARD_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Unambiguous alphabet (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Returns the user's referral code, generating one on first access. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (profile.referralCode) return profile.referralCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await prisma.profile.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch {
      // Unique collision (astronomically rare); retry with a new code.
    }
  }
  throw new Error("Could not generate a referral code");
}

/**
 * Attributes a new signup to a referrer via the code from /signup?ref=CODE
 * (carried through Supabase user metadata). No-op for invalid codes or
 * self-referrals; only ever applies once per user.
 */
export async function attributeReferral(newUserId: string, code: string): Promise<void> {
  try {
    const normalized = code.trim().toUpperCase();
    if (!normalized || normalized.length > 32) return;

    const referrer = await prisma.profile.findUnique({
      where: { referralCode: normalized },
      select: { id: true },
    });
    if (!referrer || referrer.id === newUserId) return;

    await prisma.$transaction([
      prisma.profile.update({
        where: { id: newUserId },
        data: { referredById: referrer.id },
      }),
      prisma.referral.create({
        data: { referrerId: referrer.id, referredUserId: newUserId, code: normalized },
      }),
    ]);
    await trackEvent(newUserId, "referral_signup", { referrerId: referrer.id });
  } catch (error) {
    // Attribution must never break signup.
    logger.error("[referrals] attribution", { error: serializeError(error) });
  }
}

/**
 * Called when a referred user upgrades to a paid plan: marks the referral
 * converted (once) and rewards the referrer with +30 days of Pro credit,
 * applied as a local trial extension.
 */
export async function convertReferral(referredUserId: string): Promise<void> {
  try {
    const referral = await prisma.referral.findUnique({
      where: { referredUserId },
    });
    if (!referral || referral.status === "CONVERTED") return;

    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: "CONVERTED", convertedAt: new Date() },
    });

    const referrerSubscription = await getOrCreateSubscription(referral.referrerId);
    const base =
      referrerSubscription.trialEndsAt && referrerSubscription.trialEndsAt > new Date()
        ? referrerSubscription.trialEndsAt
        : new Date();
    await prisma.subscription.update({
      where: { userId: referral.referrerId },
      data: { trialEndsAt: new Date(base.getTime() + REFERRAL_REWARD_DAYS * MS_PER_DAY) },
    });

    await trackEvent(referral.referrerId, "referral_converted", {
      referredUserId,
      rewardDays: REFERRAL_REWARD_DAYS,
    });
  } catch (error) {
    logger.error("[referrals] conversion", { error: serializeError(error) });
  }
}

export interface ReferralStats {
  code: string;
  total: number;
  converted: number;
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const code = await getOrCreateReferralCode(userId);
  const [total, converted] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.count({ where: { referrerId: userId, status: "CONVERTED" } }),
  ]);
  return { code, total, converted };
}
