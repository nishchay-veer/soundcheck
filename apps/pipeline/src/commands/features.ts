import { notImplemented, type PipelineCommand } from "./types";

export const features: PipelineCommand = {
  name: "features",
  description: "Align beats to the 100-bin timeline and write the feature matrix",
  configure: notImplemented("features"),
};
