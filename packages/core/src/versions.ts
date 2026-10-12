/**
 * Pipeline versions. Every row and document a step writes stores the version
 * that produced it; bumping one makes that step redo its work (CLAUDE.md rule 7).
 */
export const INGEST_VERSION = "ingest-v1";
// beats-v2: sharper beat type and framing definitions (Phase 06 iteration 1).
// beats-v3: six framings, without `mixed` (iteration 2; answer schema beats-v2).
// beats-v4: talking_head_share and visual instead of framing (iteration 3; schema beats-v3).
// beats-v5: observable energy anchors and sharper visual rules (iteration 4; prompt only).
export const EXTRACTION_VERSION = "beats-v5";
// A hash of the feature spec (features/spec.ts); spec.test.ts says when it must change.
export const FEATURE_VERSION = "feat-bf1e3064fa6f";
// hazard-v2: the covariance is scaled by the quasi-likelihood dispersion (Phase 08).
export const MODEL_VERSION = "hazard-v2";
// serving-v1: the Phase 11 serving documents (summary, video index, video pages).
// serving-v2: audience cards list every simulated effect (Phase 12).
// serving-v3: beats carry a transcript excerpt (Phase 13).
export const PUBLISH_VERSION = "serving-v3";
