import { baselineLlm } from "./baseline-llm";
import { consistency } from "./consistency";
import { extract } from "./extract";
import { features } from "./features";
import { ingest } from "./ingest";
import { publish } from "./publish";
import { soundcheck } from "./soundcheck";
import { stage } from "./stage";
import { traits } from "./traits";
import type { PipelineCommand } from "./types";

/** In pipeline order. */
export const commands: readonly PipelineCommand[] = [
  ingest,
  extract,
  consistency,
  features,
  traits,
  baselineLlm,
  stage,
  publish,
  soundcheck,
];
