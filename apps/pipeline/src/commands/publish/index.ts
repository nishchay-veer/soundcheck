import { notImplemented, type PipelineCommand } from "../types";

export const publish: PipelineCommand = {
  name: "publish",
  description: "Write screen documents to Firestore from model artifacts",
  configure: notImplemented("publish"),
};
