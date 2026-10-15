import { readFile } from "node:fs/promises";
import { LRUCache } from "lru-cache";
import { fixturesMode } from "../env";
import { InvalidEditsError, NotFoundError, SoundcheckNotReadyError } from "../errors";
import { toFeatureBeat, type FeatureVideo } from "../features";
import { getStorage } from "../gcp";
import {
  CUT_DRAWS,
  applyEdits,
  compareCuts,
  cutSampler,
  judging,
  loadArtifact,
  percentiles,
  presentWeights,
  simulateCut,
  type CutModel,
  type CutSampler,
  type SimulatedCut,
} from "../model";
import {
  channelIdSchema,
  measuredAudienceSchema,
  simulationSchema,
  soundcheckIdSchema,
  soundcheckInputsSchema,
  soundcheckPaths,
  type MeasuredAudience,
  type ModelArtifact,
  type Percentiles,
  type SimulateRequest,
  type Simulation,
  type SoundcheckInputs,
} from "../schemas";
import { requireChannel } from "./authz";
import { fixtureObjectPath, readDocument } from "./store";

/**
 * Simulating edits on the request path (Phase 15): the soundcheck's stored
 * inputs and its models' artifacts, the same seeded draws the job used, and no
 * Gemini or BigQuery. An instance keeps artifacts and each soundcheck's draws
 * in memory, so toggling edits costs one simulation.
 */

const MEASURED = measuredAudienceSchema.options;

/** Artifacts by URI: never rewritten, so kept until evicted. */
const artifacts = new LRUCache<string, ModelArtifact>({ max: 32 });

interface Prepared {
  sampler: CutSampler;
  video: FeatureVideo;
  durationS: number;
  inputs: SoundcheckInputs;
  baseline: SimulatedCut;
}

/** Each soundcheck's draws and its cut as it is, by soundcheck and inputs version. */
const prepared = new LRUCache<string, Prepared>({ max: 64 });

/** Forgets what this instance keeps (tests). */
export function resetSimulationCache(): void {
  artifacts.clear();
  prepared.clear();
}

/** A model artifact from Cloud Storage, or from the fixtures in fixtures mode. */
async function readArtifact(uri: string): Promise<ModelArtifact> {
  const cached = artifacts.get(uri);
  if (cached) return cached;
  let text: string;
  if (fixturesMode()) {
    text = await readFile(fixtureObjectPath(uri), "utf8");
  } else {
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (!match?.[1] || !match[2]) throw new RangeError(`Not a gs:// URI: ${uri}`);
    const [contents] = await getStorage().bucket(match[1]).file(match[2]).download();
    text = contents.toString("utf8");
  }
  const artifact = loadArtifact(JSON.parse(text));
  artifacts.set(uri, artifact);
  return artifact;
}

async function prepare(key: string, inputs: SoundcheckInputs): Promise<Prepared> {
  const cached = prepared.get(key);
  if (cached) return cached;
  const models: Partial<Record<MeasuredAudience, CutModel>> = {};
  for (const audience of MEASURED) {
    const ref = inputs.models[audience];
    if (ref)
      models[audience] = {
        artifact: await readArtifact(ref.artifactUri),
        inflation: ref.inflation,
      };
  }
  const video: FeatureVideo = {
    format: inputs.video.format,
    target_level: inputs.video.targetLevel,
    payoff_time_s: inputs.video.payoffTimeS,
    beats: inputs.beats.map(toFeatureBeat),
  };
  const sampler = cutSampler(models, { seed: inputs.seed, draws: CUT_DRAWS });
  const result: Prepared = {
    sampler,
    video,
    durationS: inputs.durationS,
    inputs,
    baseline: simulateCut(sampler, { video, durationS: inputs.durationS }, inputs.mix),
  };
  prepared.set(key, result);
  return result;
}

const round = (value: number, places: number) => Number(value.toFixed(places));
const curve = (values: ArrayLike<number>) =>
  Array.from(values, (value) => round(Math.min(1, Math.max(0, value)), 4));
const spread = ({ p10, p50, p90 }: Percentiles, places: number, scale = 1): Percentiles => ({
  p10: round(p10 * scale, places),
  p50: round(p50 * scale, places),
  p90: round(p90 * scale, places),
});

/**
 * The soundcheck's cut with `edits`, predicted for each audience and both
 * together, and the change against the cut as it is. Someone else's channel
 * or soundcheck is a NotFoundError; one without a prediction yet is
 * SoundcheckNotReadyError; edits that cannot go together are InvalidEditsError.
 */
export async function simulateSoundcheck(
  userId: string,
  channelId: string,
  soundcheckId: string,
  request: SimulateRequest,
): Promise<Simulation> {
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  if (!soundcheckIdSchema.safeParse(soundcheckId).success) {
    await requireChannel(userId, channelId);
    throw new NotFoundError("soundcheck");
  }
  const paths = soundcheckPaths(channelId);
  const [, data] = await Promise.all([
    requireChannel(userId, channelId),
    readDocument(paths.inputs(soundcheckId)),
  ]);
  if (data === undefined) {
    if ((await readDocument(paths.soundcheck(soundcheckId))) === undefined) {
      throw new NotFoundError("soundcheck");
    }
    throw new SoundcheckNotReadyError(soundcheckId);
  }
  const inputs = soundcheckInputsSchema.parse(data);
  const { sampler, video, durationS, baseline } = await prepare(
    `${channelId}/${soundcheckId}/${inputs.createdAt}`,
    inputs,
  );

  let edited: ReturnType<typeof applyEdits>;
  try {
    edited = applyEdits(video, durationS, request.edits);
  } catch (error) {
    if (error instanceof RangeError) throw new InvalidEditsError(error.message);
    throw error;
  }
  const simulated = simulateCut(sampler, edited, inputs.mix, { bands: true });

  const weights = presentWeights(sampler, inputs.weights);
  const audiences: Simulation["audiences"] = {};
  const combined = new Float64Array(sampler.draws);
  for (const audience of MEASURED) {
    const avps = simulated.avp[audience];
    const band = simulated.bands[audience];
    if (!avps || !band) continue;
    avps.forEach(
      (avp, draw) => (combined[draw] = (combined[draw] as number) + weights[audience] * avp),
    );
    const avp = percentiles(avps);
    audiences[audience] = {
      band: { p10: curve(band.p10), p50: curve(band.p50), p90: curve(band.p90) },
      avp: spread(avp, 2),
      avdS: spread(avp, 1, edited.durationS / 100),
    };
  }
  const avp = percentiles(combined);
  // The change is judged on the same audiences as the job's edits: those whose model is usable.
  const judged = judging(
    inputs.weights,
    Object.fromEntries(
      MEASURED.flatMap((audience) => {
        const ref = inputs.models[audience];
        return ref ? [[audience, ref.stamp.usable]] : [];
      }),
    ),
  );
  const judgedWeights = judged?.weights ?? inputs.weights;
  return simulationSchema.parse({
    durationS: round(edited.durationS, 2),
    audiences,
    avp: spread(avp, 2),
    avdS: spread(avp, 1, edited.durationS / 100),
    delta: {
      avdS: spread(compareCuts(sampler, baseline, simulated, judgedWeights, "avd").delta, 1),
      avpPp: spread(compareCuts(sampler, baseline, simulated, judgedWeights, "avp").delta, 2),
    },
    spans: edited.spans.map((span) => ({
      beat: span.beat,
      startS: round(span.startS, 2),
      endS: round(span.endS, 2),
      fromS: round(span.fromS, 2),
      toS: round(span.toS, 2),
      edit: span.edit,
    })),
  });
}
