import { pickServerEnv } from "../env";
import { getBigQuery } from "../gcp";
import { featureSpecRowSchema, type FeatureSpecDocument } from "../schemas";

/**
 * Stores the spec of a feature version in `feature_specs` unless that version
 * is already there. A version is a hash of its spec, so an existing row never
 * needs replacing. One MERGE statement, so two channels building features at
 * once cannot both insert it. Returns whether a row was inserted.
 */
export async function saveFeatureSpec({
  version,
  document,
  now = new Date(),
}: {
  version: string;
  document: FeatureSpecDocument;
  now?: Date;
}): Promise<boolean> {
  const row = featureSpecRowSchema.parse({
    feature_version: version,
    spec: document,
    created_at: now.toISOString(),
  });
  const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_DATASET", "BQ_LOCATION"]);
  const table = `${env.GCP_PROJECT_ID}.${env.BQ_DATASET}.feature_specs`;
  const [job] = await getBigQuery().createQueryJob({
    query: `MERGE \`${table}\` T USING (SELECT 1) S ON T.feature_version = @feature_version WHEN NOT MATCHED THEN INSERT (feature_version, spec, created_at) VALUES (@feature_version, PARSE_JSON(@spec), TIMESTAMP(@created_at))`,
    params: {
      feature_version: row.feature_version,
      spec: JSON.stringify(row.spec),
      created_at: row.created_at,
    },
    location: env.BQ_LOCATION,
  });
  await job.getQueryResults();
  const [metadata] = await job.getMetadata();
  return Number(metadata.statistics?.query?.numDmlAffectedRows ?? 0) > 0;
}
