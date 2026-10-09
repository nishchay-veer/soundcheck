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
export const FEATURE_VERSION = "feat-v1";
export const MODEL_VERSION = "hazard-v1";
