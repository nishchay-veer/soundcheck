import { notImplemented, type PipelineCommand } from "./types";

export const ingest: PipelineCommand = {
  name: "ingest",
  description: "Fetch retention curves and video metadata from the YouTube APIs",
  run: notImplemented("ingest"),
};
