"use client";

import { useState } from "react";

import { PasskeySetupPrompt } from "@/components/auth/passkey-setup-prompt";
import { ProductTour } from "@/components/tour/product-tour";
import type { Edition } from "@/lib/branding";

type Props = {
  /** Whether the profile already has tourCompletedAt set. */
  tourCompleted: boolean;
  edition: Edition;
};

/**
 * Coordinates first-run overlays on the dashboard: product tour first, then
 * the passkey nudge. Tour skip/complete unblocks the passkey prompt in-session.
 */
export function FirstRunPrompts({ tourCompleted, edition }: Props) {
  const [tourDone, setTourDone] = useState(tourCompleted);

  return (
    <>
      {!tourDone ? <ProductTour edition={edition} onDone={() => setTourDone(true)} /> : null}
      {tourDone ? <PasskeySetupPrompt /> : null}
    </>
  );
}
