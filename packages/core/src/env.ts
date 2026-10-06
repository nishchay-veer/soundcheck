import { z } from "zod";

/**
 * The only module that reads `process.env` (CLAUDE.md rule 4). Server code
 * calls `getEnv()`, client code calls `getClientEnv()`, and batch jobs call
 * `getJobEnv()` for the Cloud Run task variables.
 */

const required = z.string().trim().min(1);
const count = z.coerce.number().int().positive();

const clientShape = {
  NEXT_PUBLIC_USE_FIXTURES: z.stringbool().default(false),
};

/** Client-safe values. Only `NEXT_PUBLIC_*` variables belong here. */
export const clientEnvSchema = z.object(clientShape);
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/** Server configuration: every variable in `.env.example`. */
export const serverEnvSchema = z.object({
  GCP_PROJECT_ID: required,
  GCP_REGION: required.default("us-central1"),
  BQ_DATASET: required.default("soundcheck"),
  BQ_LOCATION: required.default("US"),
  GCS_RAW_BUCKET: required,
  GCS_UPLOADS_BUCKET: required,
  GCS_MEDIA_BUCKET: required,
  FIRESTORE_DATABASE: required.default("(default)"),
  KMS_KEY_NAME: required,
  AUTH_GOOGLE_ID: required,
  AUTH_GOOGLE_SECRET: required,
  // Auth.js encrypts the session cookie with this; `openssl rand -base64 32`.
  AUTH_SECRET: required.min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_URL: z.url().optional(),
  GEMINI_LOCATION: required.default("global"),
  GEMINI_MODEL: required,
  GEMINI_FLASH_MODEL: required,
  // Optional until the phases that use them: Imagen is a stretch goal and the
  // workflows are wired in Phase 10. The code that needs them checks presence.
  IMAGEN_MODEL: required.optional(),
  WORKFLOW_CHANNEL_BUILD: required.optional(),
  WORKFLOW_SOUNDCHECK: required.optional(),
  MIN_VIEWS: count.default(500),
  MIN_TRAIN_VIDEOS: count.default(30),
  DEMO_CHANNEL_ID: required.optional(),
  ...clientShape,
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Set by Cloud Run Jobs on every task; defaults describe a single local run. */
export const jobEnvSchema = z
  .object({
    CLOUD_RUN_TASK_INDEX: z.coerce.number().int().nonnegative().default(0),
    CLOUD_RUN_TASK_COUNT: count.default(1),
  })
  .refine((env) => env.CLOUD_RUN_TASK_INDEX < env.CLOUD_RUN_TASK_COUNT, {
    message: "CLOUD_RUN_TASK_INDEX must be less than CLOUD_RUN_TASK_COUNT",
    path: ["CLOUD_RUN_TASK_INDEX"],
  });
export type JobEnv = z.infer<typeof jobEnvSchema>;

export class EnvError extends Error {
  constructor(scope: string, error: z.ZodError) {
    super(`Invalid ${scope} environment:\n${z.prettifyError(error)}`);
    this.name = "EnvError";
  }
}

type EnvSource = Record<string, string | undefined>;

function parseEnv<S extends z.ZodType>(scope: string, schema: S, source: EnvSource): z.infer<S> {
  // An empty assignment (`GCP_REGION=` copied from .env.example) means "unset".
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = schema.safeParse(present);
  if (!result.success) throw new EnvError(scope, result.error);
  return result.data;
}

export const parseServerEnv = (source: EnvSource): ServerEnv =>
  parseEnv("server", serverEnvSchema, source);
export const parseClientEnv = (source: EnvSource): ClientEnv =>
  parseEnv("client", clientEnvSchema, source);
export const parseJobEnv = (source: EnvSource): JobEnv => parseEnv("job", jobEnvSchema, source);

let serverEnv: ServerEnv | undefined;
let clientEnv: ClientEnv | undefined;
let jobEnv: JobEnv | undefined;

export function getEnv(): ServerEnv {
  serverEnv ??= parseServerEnv(process.env);
  return serverEnv;
}

/**
 * Parses only the named server variables, uncached. For scripts and probes that
 * need a few values and should not fail on unrelated unset ones.
 */
export function pickServerEnv<K extends keyof ServerEnv>(
  keys: readonly K[],
  source: EnvSource = process.env,
): Pick<ServerEnv, K> {
  // The picked schema's output is exactly Pick<ServerEnv, K>; zod cannot infer it
  // for a generic key list, so the schema is typed loosely and the result cast.
  const schema: z.ZodType = z.object(
    Object.fromEntries(keys.map((key) => [key, serverEnvSchema.shape[key]])),
  );
  return parseEnv("server", schema, source) as Pick<ServerEnv, K>;
}

export function getClientEnv(): ClientEnv {
  // Next.js inlines NEXT_PUBLIC_* into client bundles only for literal
  // `process.env.NAME` reads, so each one is listed explicitly.
  clientEnv ??= parseClientEnv({
    NEXT_PUBLIC_USE_FIXTURES: process.env.NEXT_PUBLIC_USE_FIXTURES,
  });
  return clientEnv;
}

export function getJobEnv(): JobEnv {
  jobEnv ??= parseJobEnv(process.env);
  return jobEnv;
}

/** Tests only: forget cached values so the next call re-reads `process.env`. */
export function resetEnvCache(): void {
  serverEnv = undefined;
  clientEnv = undefined;
  jobEnv = undefined;
}
