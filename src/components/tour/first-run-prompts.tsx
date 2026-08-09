"use client";

import { useState } from "react";

import { PasskeySetupPrompt } from "@/components/auth/passkey-setup-prompt";
import {
  WelcomeCelebration,
  type CelebrationVariant,
} from "@/components/billing/welcome-celebration";
import { ProductTour } from "@/components/tour/product-tour";
import type { Edition } from "@/lib/branding";

type Props = {
  /** Whether the profile already has tourCompletedAt set. */
  tourCompleted: boolean;
  /** Whether to show the one-shot gems/confetti celebration. */
  showCelebration: boolean;
  /** Dialog copy: complimentary Enterprise vs general welcome. */
  celebrationVariant: CelebrationVariant;
  edition: Edition;
};

/**
 * Coordinates first-run overlays on the dashboard: product tour first, then
 * the welcome/Enterprise celebration, then the passkey nudge.
 */
export function FirstRunPrompts({
  tourCompleted,
  showCelebration,
  celebrationVariant,
  edition,
}: Props) {
  const [tourDone, setTourDone] = useState(tourCompleted);
  const [celebrationDone, setCelebrationDone] = useState(!showCelebration);

  return (
    <>
      {!tourDone ? <ProductTour edition={edition} onDone={() => setTourDone(true)} /> : null}
      {tourDone && !celebrationDone ? (
        <WelcomeCelebration
          variant={celebrationVariant}
          onDone={() => setCelebrationDone(true)}
        />
      ) : null}
      {tourDone && celebrationDone ? <PasskeySetupPrompt /> : null}
    </>
  );
}
