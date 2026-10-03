/**
 * Phase 01 smoke test: sends one short prompt to each configured Gemini model
 * on Vertex AI and prints the reply and token usage. Authenticates with
 * Application Default Credentials (`gcloud auth application-default login`).
 *
 *   pnpm --filter @soundcheck/scripts vertex-smoke
 *
 * Reads GCP_PROJECT_ID, GEMINI_LOCATION, GEMINI_MODEL and GEMINI_FLASH_MODEL
 * from the repo-root .env.
 */
import { GoogleGenAI } from "@google/genai";
import { pickServerEnv, withRetry } from "@soundcheck/core";

const PROMPT = "In one short sentence, confirm you can read this message.";

const HINTS: Record<number, string> = {
  400: "Check that the model ID is valid for this location.",
  403: "Check that aiplatform.googleapis.com is enabled and your account has roles/aiplatform.user.",
  404: "The model ID was not found in this location. Check the Vertex AI model list.",
  429: "Quota exhausted. Request a Gemini quota increase (infra/README.md).",
};

async function smoke(ai: GoogleGenAI, variable: string, model: string): Promise<void> {
  const response = await withRetry(() => ai.models.generateContent({ model, contents: PROMPT }), {
    operation: `vertex.generateContent(${variable})`,
  });
  const reply = response.text?.trim();
  if (!reply) throw new Error(`${variable} (${model}) returned no text`);
  const usage = response.usageMetadata;
  process.stdout.write(
    [
      `${variable} = ${model}`,
      `  reply:  ${reply}`,
      `  tokens: prompt ${usage?.promptTokenCount ?? "?"}, output ${usage?.candidatesTokenCount ?? "?"}, ` +
        `thinking ${usage?.thoughtsTokenCount ?? 0}, total ${usage?.totalTokenCount ?? "?"}`,
      "",
    ].join("\n"),
  );
}

const env = pickServerEnv([
  "GCP_PROJECT_ID",
  "GEMINI_LOCATION",
  "GEMINI_MODEL",
  "GEMINI_FLASH_MODEL",
]);
const ai = new GoogleGenAI({
  vertexai: true,
  project: env.GCP_PROJECT_ID,
  location: env.GEMINI_LOCATION,
});
process.stdout.write(
  `Vertex AI: project ${env.GCP_PROJECT_ID}, location ${env.GEMINI_LOCATION}\n\n`,
);

try {
  await smoke(ai, "GEMINI_MODEL", env.GEMINI_MODEL);
  await smoke(ai, "GEMINI_FLASH_MODEL", env.GEMINI_FLASH_MODEL);
} catch (error) {
  const status = (error as { status?: unknown }).status;
  const hint = typeof status === "number" ? HINTS[status] : undefined;
  process.stderr.write(`Smoke test failed: ${(error as Error).message}\n`);
  if (hint) process.stderr.write(`Hint: ${hint}\n`);
  process.exitCode = 1;
}
