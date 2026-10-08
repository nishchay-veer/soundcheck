/**
 * The fixed videos the extraction quality gate runs on. Keep this list
 * unchanged across iterations so numbers stay comparable (Phase 06): four
 * public videos of other formats chosen by Nishchay, and the test channel's
 * two videos that are not few-shot examples (the examples would agree with
 * themselves and inflate the scores).
 */
export const CONSISTENCY_TEST_SET = [
  { id: "AgUATWAOaKY", kind: "tutorial" },
  { id: "RwkGSPp6yG0", kind: "vlog" },
  { id: "ohqxP8EEumo", kind: "review" },
  { id: "S9H3sqKc9Y4", kind: "explainer" },
  { id: "FhcM0zUTVv0", kind: "music performance" },
  { id: "zSOdb1KzLO8", kind: "short" },
] as const;

export type TestVideo = { id: string; kind: string };
