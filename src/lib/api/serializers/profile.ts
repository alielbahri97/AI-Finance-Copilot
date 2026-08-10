/**
 * Profile shaping shared by `/api/session/bootstrap` and `/api/profile`.
 *
 * The inputs are declared structurally rather than as Prisma payload types so
 * a route can hand over a `select`ed subset, and so the serializers stay
 * unit-testable without a client.
 */

import { moneyOrNull, timestampOrNull, type MoneyString, type TimestampString } from "@/lib/api/wire";
import {
  LIFE_STAGE_LABELS,
  PRIMARY_FOCUS_LABELS,
  type LifeStageId,
  type PrimaryFocusId,
} from "@/lib/onboarding/personal";

/** Everything the wire needs from a `Profile` row. */
export interface ProfileRow {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  currency: string;
  aiProvider: string;
  isAdmin: boolean;
  tourCompletedAt: Date | null;
  celebrationSeenAt: Date | null;
}

export interface SerializedProfile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /**
   * The stored preference verbatim. A client that renders a currency picker
   * should fall back to USD when this is not in `supportedCurrencies`, which is
   * what the web profile page does.
   */
  currency: string;
  aiProvider: string;
  isAdmin: boolean;
  tourCompletedAt: TimestampString | null;
  celebrationSeenAt: TimestampString | null;
}

export function serializeProfile(profile: ProfileRow): SerializedProfile {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    currency: profile.currency,
    aiProvider: profile.aiProvider,
    isAdmin: profile.isAdmin,
    tourCompletedAt: timestampOrNull(profile.tourCompletedAt),
    celebrationSeenAt: timestampOrNull(profile.celebrationSeenAt),
  };
}

/** Amounts arrive as Prisma `Decimal`, which carries `toFixed`. */
type DecimalLike = { toFixed(digits: number): string };

export interface PersonalProfileRow {
  lifeStage: string;
  primaryFocus: string;
  monthlyIncome: DecimalLike | null;
  monthlyEssentials: DecimalLike | null;
  hasDebt: boolean;
  emergencyMonths: number;
  notes: string | null;
  completedAt: Date | null;
  skippedAt: Date | null;
}

export interface SerializedPersonalProfile {
  lifeStage: string;
  /** Falls back to the raw id for a value the label map does not know. */
  lifeStageLabel: string;
  primaryFocus: string;
  primaryFocusLabel: string;
  monthlyIncome: MoneyString | null;
  monthlyEssentials: MoneyString | null;
  hasDebt: boolean;
  emergencyMonths: number;
  notes: string | null;
  completedAt: TimestampString | null;
  skippedAt: TimestampString | null;
  /** True once the questionnaire was either completed or skipped. */
  done: boolean;
}

export function serializePersonalProfile(
  row: PersonalProfileRow | null
): SerializedPersonalProfile | null {
  if (!row) return null;
  return {
    lifeStage: row.lifeStage,
    lifeStageLabel: LIFE_STAGE_LABELS[row.lifeStage as LifeStageId] ?? row.lifeStage,
    primaryFocus: row.primaryFocus,
    primaryFocusLabel: PRIMARY_FOCUS_LABELS[row.primaryFocus as PrimaryFocusId] ?? row.primaryFocus,
    monthlyIncome: moneyOrNull(row.monthlyIncome),
    monthlyEssentials: moneyOrNull(row.monthlyEssentials),
    hasDebt: row.hasDebt,
    emergencyMonths: row.emergencyMonths,
    notes: row.notes,
    completedAt: timestampOrNull(row.completedAt),
    skippedAt: timestampOrNull(row.skippedAt),
    done: Boolean(row.completedAt || row.skippedAt),
  };
}

export interface BusinessProfileRow {
  businessType: string;
  employeeRange: string;
  monthlyRent: DecimalLike | null;
  monthlyRevenue: DecimalLike | null;
  location: string | null;
  businessNotes: string | null;
  completedAt: Date | null;
  skippedAt: Date | null;
}

export interface SerializedBusinessProfile {
  businessType: string;
  employeeRange: string;
  monthlyRent: MoneyString | null;
  monthlyRevenue: MoneyString | null;
  location: string | null;
  businessNotes: string | null;
  completedAt: TimestampString | null;
  skippedAt: TimestampString | null;
  done: boolean;
}

export function serializeBusinessProfile(
  row: BusinessProfileRow | null
): SerializedBusinessProfile | null {
  if (!row) return null;
  return {
    businessType: row.businessType,
    employeeRange: row.employeeRange,
    monthlyRent: moneyOrNull(row.monthlyRent),
    monthlyRevenue: moneyOrNull(row.monthlyRevenue),
    location: row.location,
    businessNotes: row.businessNotes,
    completedAt: timestampOrNull(row.completedAt),
    skippedAt: timestampOrNull(row.skippedAt),
    done: Boolean(row.completedAt || row.skippedAt),
  };
}
