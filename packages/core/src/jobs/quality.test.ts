import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeBigQuery } from "../fake-bigquery";
import { FakeFirestore } from "../fake-firestore";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import {
  extractionGate,
  latestQualityVerdict,
  saveExtractionGate,
  loadQualityReports,
  readQualityReports,
  writeQualityReport,
} from "./quality";

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
  let db: FakeFirestore;

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
    db = new FakeFirestore();
    setClientOverride("firestore", db.asFirestore());
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

  it("reads an extraction version's verdict kept apart from every channel", async () => {
    await saveExtractionGate({
      extractionVersion: "beats-v5",
      passed: true,
      reportId: "gate1",
      decidedAt: new Date("2026-10-10T00:00:00Z"),
    });
    const asked = vi.spyOn(bigquery, "query");
    expect(await extractionGate("extraction-quality-gate", "beats-v5")).toEqual({
      reportId: "gate1",
      passed: true,
    });
    expect(asked).not.toHaveBeenCalled();
  });

  it("moves a verdict that is only in quality_reports to where a channel's deletion cannot reach it", async () => {
    bigquery.respondTo(/^SELECT report_id, channel_id, JSON_VALUE\(details, '\$\.passed'\)/, (p) =>
      p.version === "beats-v5" ? [{ report_id: "gate1", channel_id: CHANNEL, passed: "true" }] : [],
    );
    const now = new Date("2026-10-16T09:00:00Z");
    expect(await extractionGate("extraction-quality-gate", "beats-v5", { now })).toEqual({
      reportId: "gate1",
      passed: true,
    });
    expect(db.docs.get("extractionGates/beats-v5")).toEqual({
      extractionVersion: "beats-v5",
      passed: true,
      reportId: "gate1",
      decidedAt: now,
    });
    expect(await extractionGate("extraction-quality-gate", "beats-v6")).toBeNull();
    expect(db.docs.has("extractionGates/beats-v6")).toBe(false);
  });

  it("reads the latest verdict for an extraction version from any channel", async () => {
    const params: Array<Record<string, unknown>> = [];
    bigquery.respondTo(
      /^SELECT report_id, channel_id, JSON_VALUE\(details, '\$\.passed'\)/,
      (p) => {
        params.push(p);
        return p.version === "beats-v5"
          ? [{ report_id: "gate1", channel_id: CHANNEL, passed: "true" }]
          : [];
      },
    );
    expect(await latestQualityVerdict("extraction-quality-gate", "beats-v5")).toEqual({
      reportId: "gate1",
      channelId: CHANNEL,
      passed: true,
    });
    expect(await latestQualityVerdict("extraction-quality-gate", "beats-v6")).toBeNull();
    expect(params[0]).toEqual({ stage: "extraction-quality-gate", version: "beats-v5" });
  });
});
