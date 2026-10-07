import { describe, expect, it } from "vitest";
import { REACH_REPORT_TYPES, parseReportingJob, parseReportingJobs } from "./reporting";

const job = (id: string, reportTypeId: string) => ({
  id,
  reportTypeId,
  name: `soundcheck ${reportTypeId}`,
  createTime: "2026-10-07T03:00:00Z",
});

describe("parseReportingJobs", () => {
  it("reads job IDs and report types", () => {
    expect(
      parseReportingJobs({
        jobs: [job("j1", "channel_reach_basic_a1"), job("j2", "channel_basic_a3")],
        nextPageToken: "next",
      }),
    ).toEqual({
      jobs: [
        { id: "j1", reportTypeId: "channel_reach_basic_a1" },
        { id: "j2", reportTypeId: "channel_basic_a3" },
      ],
      nextPageToken: "next",
    });
  });

  it("treats a missing jobs list as none", () => {
    expect(parseReportingJobs({})).toEqual({ jobs: [], nextPageToken: null });
  });
});

describe("parseReportingJob", () => {
  it("reads a created job", () => {
    expect(parseReportingJob(job("j9", "channel_reach_combined_a1"))).toEqual({
      id: "j9",
      reportTypeId: "channel_reach_combined_a1",
    });
  });

  it("rejects a body without an ID", () => {
    expect(() => parseReportingJob({ reportTypeId: "channel_reach_basic_a1" })).toThrow();
  });
});

describe("REACH_REPORT_TYPES", () => {
  it("names both channel reach reports", () => {
    expect(REACH_REPORT_TYPES).toEqual(["channel_reach_basic_a1", "channel_reach_combined_a1"]);
  });
});
