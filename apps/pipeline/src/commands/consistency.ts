import { notImplemented, type PipelineCommand } from "./types";

export const consistency: PipelineCommand = {
  name: "consistency",
  description: "Measure how consistently Gemini labels the same video",
  configure: notImplemented("consistency"),
};
