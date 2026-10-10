/**
 * Writes the model artifact and `model_runs` JSON Schemas and the model's
 * columns and settings to services/modeling/schemas/, for the Python fitter.
 * Run after changing either schema or `packages/core/src/model/config.ts`:
 *   pnpm gen:schemas
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { MODEL_EXPORTS_DIR, modelExports } from "@soundcheck/core/model";

const dir = new URL(`../${MODEL_EXPORTS_DIR}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, value] of Object.entries(modelExports())) {
  writeFileSync(new URL(name, dir), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${MODEL_EXPORTS_DIR}/${name}`);
}
