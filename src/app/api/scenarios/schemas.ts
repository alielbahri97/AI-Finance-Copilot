import { z } from "zod";

/**
 * Request validation for the scenario routes. Lives beside the routes rather
 * than in `@/lib/validations` because nothing outside `/api/scenarios` and the
 * one extra field on `/api/assumptions` submits a scenario.
 */

/**
 * Short enough to read in a switcher tab. A scenario name is a label for a
 * hypothesis ("Hire in Q4"), not a description of it.
 */
const name = z.string().trim().min(1, "Name the scenario").max(60);

export const scenarioCreateSchema = z.object({
  name,
  /** Makes it the scenario the forecast page opens on. */
  isDefault: z.boolean().optional(),
});

/** Both fields optional: absent means "leave as it is". */
export const scenarioUpdateSchema = z
  .object({
    name: name.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((values) => values.name !== undefined || values.isDefault !== undefined, {
    message: "Nothing to update",
  });

/** A name for the copy; the route invents one when it is absent. */
export const scenarioDuplicateSchema = z.object({ name: name.optional() });

/**
 * The scenario an assumption is written into, accepted by
 * `POST /api/assumptions`. Absent or `"base"` means the base scenario, which is
 * a NULL column and the only thing every assumption written before scenarios
 * existed has ever held.
 */
export const assumptionScenarioSchema = z.object({
  scenarioId: z.string().trim().min(1).max(64).nullish(),
});
