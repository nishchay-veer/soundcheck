/**
 * Pipeline versions. Every row and document a step writes stores the version
 * that produced it; bumping one makes that step redo its work (CLAUDE.md rule 7).
 */
export const INGEST_VERSION = "ingest-v1";
// beats-v2: sharper beat type and framing definitions (Phase 06 iteration 1);
// the answer's schema is unchanged, so its schema_version stays beats-v1.
export const EXTRACTION_VERSION = "beats-v2";
export const FEATURE_VERSION = "feat-v1";
export const MODEL_VERSION = "hazard-v1";
