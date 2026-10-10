import { getStorage } from "../gcp";
import {
  modelArtifactSchema,
  trainingAudienceSchema,
  type ModelArtifact,
  type TrainingAudience,
} from "../schemas";
import { readChannelRows } from "./tables";

/** One fitted model, as `model_runs` records it. */
export interface FittedModel {
  runId: string;
  audience: TrainingAudience;
  finishedAt: string;
  artifactUri: string;
}

/** TIMESTAMP values arrive from the client as `{ value }` objects. */
const plain = (value: unknown): string =>
  String(
    value !== null && typeof value === "object" && "value" in value
      ? (value as { value: unknown }).value
      : value,
  );

/**
 * The channel's latest fitted model per audience for a model and feature
 * version, from `model_runs`. Usable or not: the artifact says.
 */
export async function latestFittedModels(
  channelId: string,
  { modelVersion, featureVersion }: { modelVersion: string; featureVersion: string },
): Promise<Map<TrainingAudience, FittedModel>> {
  const rows = await readChannelRows(
    "model_runs",
    [
      "run_id",
      "audience",
      "status",
      "model_version",
      "feature_version",
      "finished_at",
      "artifact_uri",
    ],
    channelId,
  );
  const latest = new Map<TrainingAudience, FittedModel>();
  for (const row of rows) {
    const audience = trainingAudienceSchema.safeParse(row.audience);
    if (
      !audience.success ||
      row.status !== "fitted" ||
      row.model_version !== modelVersion ||
      row.feature_version !== featureVersion ||
      typeof row.artifact_uri !== "string"
    ) {
      continue;
    }
    const model = {
      runId: String(row.run_id),
      audience: audience.data,
      finishedAt: plain(row.finished_at),
      artifactUri: row.artifact_uri,
    };
    const current = latest.get(audience.data);
    if (!current || model.finishedAt > current.finishedAt) latest.set(audience.data, model);
  }
  return latest;
}

/** A model artifact from `gs://bucket/path`, validated. */
export async function readModelArtifact(uri: string): Promise<ModelArtifact> {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match?.[1] || !match[2]) throw new RangeError(`Not a gs:// URI: ${uri}`);
  const [contents] = await getStorage().bucket(match[1]).file(match[2]).download();
  return modelArtifactSchema.parse(JSON.parse(contents.toString("utf8")));
}
