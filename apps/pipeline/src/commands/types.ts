export interface PipelineCommand {
  name: string;
  description: string;
  run: () => void | Promise<void>;
}

export function notImplemented(name: string): () => void {
  return () => {
    process.stdout.write(`${name}: not implemented\n`);
  };
}
