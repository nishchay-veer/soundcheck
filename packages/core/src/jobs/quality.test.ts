import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeBigQuery } from "../fake-bigquery";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { loadQualityReports, readQualityReports, writeQualityReport } from "./quality";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const quiet = createLogger({ level: "silent" });
const report = (id: string, createdAt: string) => ({
  report_id: id,
  channel_id: CHANNEL,
  stage: "extraction-consistency",
  run_id: id,
  created_at: createdAt,
  details: { passed: false },
});

describe("quality reports", () => {
  let storage: FakeStorage;
  let bigquery: FakeBigQuery;

  beforeEach(() => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    storage = new FakeStorage();
    bigquery = new FakeBigQuery(
      { quality_reports: [] },
      {
        columns: {
          quality_reports: ["report_id", "channel_id", "stage", "run_id", "created_at", "details"],
        },
        storage,
      },
    );
    setClientOverride("storage", storage.asStorage());
    setClientOverride("bigquery", bigquery.asBigQuery());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("keeps every report, oldest first, and skips unreadable files", async () => {
    await writeQualityReport(report("second", "2026-10-09T10:00:00.000Z"));
    await writeQualityReport(report("first", "2026-10-08T10:00:00.000Z"));
    await storage.bucket("test-raw").file(`${CHANNEL}/quality-reports/broken.json`).save("{");
    expect((await readQualityReports(CHANNEL)).map((r) => r.report_id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("rebuilds the table from all reports, so iterations accumulate", async () => {
    await writeQualityReport(report("first", "2026-10-08T10:00:00.000Z"));
    expect(await loadQualityReports(CHANNEL, { runId: "load1", log: quiet })).toBe(1);
    await writeQualityReport(report("second", "2026-10-09T10:00:00.000Z"));
    expect(await loadQualityReports(CHANNEL, { runId: "load2", log: quiet })).toBe(2);
    expect(bigquery.tables.quality_reports?.map((row) => row.report_id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("refuses an invalid report", async () => {
    await expect(
      writeQualityReport({ ...report("x", "2026-10-08T10:00:00.000Z"), report_id: "../x" }),
    ).rejects.toThrow();
  });
});
