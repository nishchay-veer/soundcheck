/**
 * Times the screens' API routes on Cloud Run (Phase 11: p95 under 150 ms).
 *
 * Signs a 10-minute session for your own account with the deployed app's
 * AUTH_SECRET, which it reads from standard input so it is never printed or
 * stored, then sends sequential requests to each route after a warm-up.
 * Each request carries a run tag (`?lt=…`), so Cloud Run's request logs give
 * the server-side latency, without the network between you and us-central1;
 * this prints the times seen from here and the tag.
 *
 *   gcloud secrets versions access latest --secret=auth-secret | \
 *     node apps/web/scripts/measure-latency.ts --user <Google ID> --channel UC… --video <video ID>
 */
import { randomUUID } from "node:crypto";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { encode } from "next-auth/jwt";

const COOKIE = "__Secure-authjs.session-token";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://soundcheck-web-513835636030.us-central1.run.app" },
    user: { type: "string" },
    channel: { type: "string" },
    video: { type: "string" },
    requests: { type: "string", default: "100" },
    warmup: { type: "string", default: "5" },
  },
});
const { url, user, channel, video } = values;
if (!user || !channel || !video) {
  process.stderr.write("Needs --user, --channel and --video\n");
  process.exit(1);
}

const secret = (await text(process.stdin)).trim();
if (secret.length < 32) {
  process.stderr.write("Pipe the deployed AUTH_SECRET in on standard input\n");
  process.exit(1);
}
const session = await encode({
  token: { sub: user, userId: user, channelIds: [channel] },
  secret,
  salt: COOKIE,
  maxAge: 600,
});
const headers = { cookie: `${COOKIE}=${session}` };
const tag = randomUUID().slice(0, 8);

const routes: Record<string, string> = {
  me: "/api/v1/me",
  channel: `/api/v1/channels/${channel}`,
  summary: `/api/v1/channels/${channel}/summary`,
  videos: `/api/v1/channels/${channel}/videos`,
  video: `/api/v1/channels/${channel}/videos/${video}`,
};

/** One request's time from here, in milliseconds; anything but 200 stops the run. */
async function timed(path: string): Promise<number> {
  const start = performance.now();
  const response = await fetch(`${url}${path}?lt=${tag}`, { headers });
  await response.arrayBuffer();
  if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
  return performance.now() - start;
}

const percentile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? Number.NaN;

const startedAt = new Date().toISOString();
for (const path of Object.values(routes)) {
  for (let i = 0; i < Number(values.warmup); i += 1) await timed(path);
}
const lines = [
  `run tag lt=${tag}, from ${startedAt}`,
  "route      n    p50 ms   p95 ms  (from here)",
];
for (const [name, path] of Object.entries(routes)) {
  const times: number[] = [];
  for (let i = 0; i < Number(values.requests); i += 1) times.push(await timed(path));
  times.sort((a, b) => a - b);
  lines.push(
    `${name.padEnd(9)} ${String(times.length).padStart(3)} ${percentile(times, 0.5).toFixed(0).padStart(8)} ${percentile(times, 0.95).toFixed(0).padStart(8)}`,
  );
}
lines.push(`until ${new Date().toISOString()}`);
process.stdout.write(`${lines.join("\n")}\n`);
