import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeBigQuery } from "../fake-bigquery";
import { FEATURE_SPEC_DOCUMENT } from "../features";
import { resetClients, setClientOverride } from "../gcp";
import { saveFeatureSpec } from "./feature-specs";

describe("saveFeatureSpec", () => {
  let bigquery: FakeBigQuery;

  beforeEach(() => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    bigquery = new FakeBigQuery({ feature_specs: [] });
    setClientOverride("bigquery", bigquery.asBigQuery());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("stores a version's spec once, as one MERGE statement", async () => {
    const now = new Date("2026-10-10T09:00:00Z");
    const save = () =>
      saveFeatureSpec({ version: "feat-abc", document: FEATURE_SPEC_DOCUMENT, now });
    expect(await save()).toBe(true);
    expect(await save()).toBe(false);
    expect(bigquery.tables.feature_specs).toEqual([
      {
        feature_version: "feat-abc",
        spec: FEATURE_SPEC_DOCUMENT,
        created_at: "2026-10-10T09:00:00.000Z",
      },
    ]);
    expect(bigquery.queries[0]?.query).toMatch(
      /^MERGE `soundcheck-test\.soundcheck\.feature_specs`/,
    );
  });

  it("keeps another version's row", async () => {
    await saveFeatureSpec({ version: "feat-old", document: FEATURE_SPEC_DOCUMENT });
    await saveFeatureSpec({ version: "feat-new", document: FEATURE_SPEC_DOCUMENT });
    expect(bigquery.tables.feature_specs?.map((row) => row.feature_version)).toEqual([
      "feat-old",
      "feat-new",
    ]);
  });
});
