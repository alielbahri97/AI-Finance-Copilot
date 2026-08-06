import { describe, expect, it } from "vitest";

import { decideWorkspaceCreationPolicy } from "@/lib/workspace/limits-core";

describe("workspace creation policy", () => {
  it("allows either edition when the account owns nothing yet", () => {
    const policy = decideWorkspaceCreationPolicy({
      ownsPersonal: false,
      ownsBusiness: false,
      crossEditionUnlocked: false,
      ownedCount: 0,
    });
    expect(policy.canCreatePersonal).toBe(true);
    expect(policy.canCreateBusiness).toBe(true);
  });

  it("blocks a second personal workspace", () => {
    const policy = decideWorkspaceCreationPolicy({
      ownsPersonal: true,
      ownsBusiness: false,
      crossEditionUnlocked: false,
      ownedCount: 1,
    });
    expect(policy.canCreatePersonal).toBe(false);
    expect(policy.canCreateBusiness).toBe(false);
  });

  it("blocks personal when owning business without unlock", () => {
    const policy = decideWorkspaceCreationPolicy({
      ownsPersonal: false,
      ownsBusiness: true,
      crossEditionUnlocked: false,
      ownedCount: 1,
    });
    expect(policy.canCreatePersonal).toBe(false);
    expect(policy.canCreateBusiness).toBe(true);
  });

  it("allows the other edition when Enterprise/Premium unlocks cross-edition", () => {
    const fromBusiness = decideWorkspaceCreationPolicy({
      ownsPersonal: false,
      ownsBusiness: true,
      crossEditionUnlocked: true,
      ownedCount: 1,
    });
    expect(fromBusiness.canCreatePersonal).toBe(true);

    const fromPersonal = decideWorkspaceCreationPolicy({
      ownsPersonal: true,
      ownsBusiness: false,
      crossEditionUnlocked: true,
      ownedCount: 1,
    });
    expect(fromPersonal.canCreateBusiness).toBe(true);
    expect(fromPersonal.canCreatePersonal).toBe(false);
  });
});
