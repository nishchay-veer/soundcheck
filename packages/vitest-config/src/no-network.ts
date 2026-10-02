import net from "node:net";

/**
 * Vitest setup file: unit tests never touch the network. Every outbound TCP or
 * TLS connection (fetch, http, gRPC, gaxios) fails before DNS resolution.
 * Unix domain sockets stay open for local IPC. Tests that need real network
 * access belong in `*.integration.test.ts` and run via `test:integration`.
 */
export class NetworkAccessError extends Error {
  constructor(target: string) {
    super(
      `Network access is disabled in unit tests (attempted ${target}). ` +
        "Use a recorded fixture, or move the test to *.integration.test.ts.",
    );
    this.name = "NetworkAccessError";
  }
}

function describeTarget(args: unknown[]): { target: string; unixSocket: boolean } {
  const [first, second] = args;
  if (typeof first === "object" && first !== null) {
    const opts = first as { path?: unknown; host?: unknown; port?: unknown };
    if (typeof opts.path === "string") return { target: opts.path, unixSocket: true };
    return {
      target: `${String(opts.host ?? "localhost")}:${String(opts.port)}`,
      unixSocket: false,
    };
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) {
    return { target: first, unixSocket: true };
  }
  const host = typeof second === "string" ? second : "localhost";
  return { target: `${host}:${String(first)}`, unixSocket: false };
}

const originalConnect = net.Socket.prototype.connect;

function blockedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
  // net.connect() passes its normalized arguments as a single array.
  const flat: unknown[] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const { target, unixSocket } = describeTarget(flat);
  if (unixSocket) {
    return Reflect.apply(originalConnect, this, args) as net.Socket;
  }
  throw new NetworkAccessError(target);
}

net.Socket.prototype.connect = blockedConnect as net.Socket["connect"];
