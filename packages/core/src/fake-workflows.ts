/**
 * In-memory stand-in for the Workflows executions client, for unit tests: it
 * records created executions and answers `getExecution` with a state the test
 * sets. Install it with `setClientOverride("workflowExecutions", fake.asExecutions())`.
 */
import type { ExecutionsClient } from "@google-cloud/workflows";

export class FakeExecutions {
  readonly created: Array<{ parent: string; argument: unknown }> = [];
  /** Execution name -> state, e.g. "ACTIVE", "CANCELLED". */
  readonly states = new Map<string, string>();
  /** Set to make `createExecution` fail. */
  failCreate: Error | undefined;

  async createExecution(request: { parent: string; execution: { argument: string } }) {
    if (this.failCreate) throw this.failCreate;
    const name = `${request.parent}/executions/exec-${this.created.length + 1}`;
    this.created.push({ parent: request.parent, argument: JSON.parse(request.execution.argument) });
    this.states.set(name, "ACTIVE");
    return [{ name }] as const;
  }

  async getExecution(request: { name: string }) {
    const state = this.states.get(request.name);
    if (state === undefined) throw Object.assign(new Error("5 NOT_FOUND"), { code: 5 });
    return [{ name: request.name, state }] as const;
  }

  asExecutions(): ExecutionsClient {
    return this as unknown as ExecutionsClient;
  }
}
