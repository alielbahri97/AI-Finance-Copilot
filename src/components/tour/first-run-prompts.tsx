"use client";

import { useState } from "react";

import { PasskeySetupPrompt } from "@/components/auth/passkey-setup-prompt";
import { EnterprisePromo } from "@/components/billing/enterprise-promo";
import { ProductTour } from "@/components/tour/product-tour";
import type { Edition } from "@/lib/branding";

type Props = {
  /** Whether the profile already has tourCompletedAt set. */
  tourCompleted: boolean;
  /** Whether to show the complimentary Enterprise celebration once. */
  showEnterprisePromo: boolean;
  edition: Edition;
};

/**
 * Coordinates first-run overlays on the dashboard: product tour first, then
 * the Enterprise promo (when granted), then the passkey nudge.
 */
export function FirstRunPrompts({ tourCompleted, showEnterprisePromo, edition }: Props) {
  const [tourDone, setTourDone] = useState(tourCompleted);
  const [promoDone, setPromoDone] = useState(!showEnterprisePromo);

  return (
    <>
      {!tourDone ? <ProductTour edition={edition} onDone={() => setTourDone(true)} /> : null}
      {tourDone && !promoDone ? <EnterprisePromo onDone={() => setPromoDone(true)} /> : null}
      {tourDone && promoDone ? <PasskeySetupPrompt /> : null}
    </>
  );
}
