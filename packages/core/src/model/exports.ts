import { z } from "zod";
import { modelArtifactSchema, modelRunRowSchema } from "../schemas";
import { MODEL_CONFIG } from "./config";

/** Where `gen:schemas` writes the exports, relative to the repo root. */
export const MODEL_EXPORTS_DIR = "services/modeling/schemas";

/**
 * What the Python fitter reads from TypeScript, by file name: the JSON
 * Schemas it validates artifacts and `model_runs` rows against, and the
 * model's columns and settings. A test fails when the committed files are stale.
 */
export function modelExports(): Record<string, unknown> {
  return {
    "model-artifact.schema.json": z.toJSONSchema(modelArtifactSchema),
    "model-run-row.schema.json": z.toJSONSchema(modelRunRowSchema),
    "model-config.json": MODEL_CONFIG,
  };
}
