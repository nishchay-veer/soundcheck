import {
  EXTRACTION_VERSION,
  childLogger,
  getFirestore,
  logger as rootLogger,
  pickServerEnv,
  type Logger,
} from "@soundcheck/core";
import {
  extractVideoBeats,
  titleChapters,
  type ExtractOptions,
  type ExtractionOutcome,
  type ExtractionTarget,
} from "@soundcheck/core/gemini";
import { archiveRaw } from "@soundcheck/core/jobs";
import {
  CUT_DRAWS,
  cutSampler,
  predictCut,
  recentAudienceMix,
  searchEdits,
  scenarioAudienceMix,
  type CutModel,
} from "@soundcheck/core/model";
import {
  SOUNDCHECK_LIMITS,
  measuredAudienceSchema,
  soundcheckDocSchema,
  soundcheckInputsSchema,
  soundcheckPaths,
  type MeasuredAudience,
  type SoundcheckDoc,
  type SoundcheckErrorCode,
  type SoundcheckStep,
} from "@soundcheck/core/schemas";
import {
  credentialsForChannel,
  fetchVideos,
  parseVideos,
  videosRequest,
} from "@soundcheck/core/youtube";
import { readChannelForCut, type ChannelForCut } from "./channel";
import { probeUpload, type ProbedFile } from "./probe";
import { displayBeats, editsDoc, effectDoc, inputsDoc, narrative, predictionDoc } from "./result";

/**
 * `soundcheck` (Phase 14, run as `job-soundcheck`): predicts one new cut.
 *
 * 1. Checking: the cut's length (ffprobe for a file; YouTube's data for a
 *    link, which also tells a private video apart before Gemini is asked).
 * 2. Watching: the Phase 05 extractor and validator, uncached, its raw
 *    answers archived in the uploads bucket so they are deleted after 30
 *    days with the upload.
 * 3. Predicting: the channel's latest models, under the creator's scenario.
 * 4. Finishing: the result and, for Phase 15, the cut as the model reads it.
 *
 * Each step updates the document's progress. A run first claims the
 * soundcheck in a transaction, so a duplicate event cannot start a second
 * run; a run that stopped updating for 20 minutes counts as dead and can be
 * replaced. A finished soundcheck is left as it is (rule 7). Every failure
 * ends as `failed` with a plain message; unexpected ones are also thrown, so
 * Cloud Run retries the task.
 */

export const SOUNDCHECK_STEP = "soundcheck";
/** Common random numbers: every prediction of a cut, and its edits, use this seed. */
export const SOUNDCHECK_SEED = 1;
/** A run that has not touched its soundcheck for this long has died. */
export const STALE_AFTER_MS = 20 * 60_000;
/** The steps a soundcheck goes through, for the progress bar. */
const STEPS: readonly SoundcheckStep[] = [
  "checking",
  "watching",
  "predicting",
  "suggesting",
  "finishing",
];
const MEASURED = measuredAudienceSchema.options;

/** What the creator reads for each failure. */
export const FAILURE_MESSAGES: Record<SoundcheckErrorCode, string> = {
  private_video:
    "This video is private, so we can't watch it. Set it to Unlisted on YouTube, or upload the file instead.",
  video_unavailable:
    "We couldn't find this video on YouTube. Check the link; if the video is private, set it to Unlisted or upload the file instead.",
  too_short: "This cut is shorter than a minute. Soundcheck works on cuts of 1 to 60 minutes.",
  too_long: "This cut is longer than 60 minutes. Soundcheck works on cuts of 1 to 60 minutes.",
  too_large: "This file is over 2 GB. Export a smaller file and upload it again.",
  unsupported_type: "This file has no picture to watch. Upload an MP4, MOV or WebM video.",
  upload_missing: "The upload didn't finish. Please upload the file again.",
  no_model: "Your channel's first build hasn't finished, so there's no model to predict with yet.",
  unreadable: "We couldn't make sense of this video, even after a second try. Please try again.",
  internal: "Something went wrong on our side. Please try again.",
};

/** A failure the creator can act on. */
export class SoundcheckFailure extends Error {
  constructor(readonly code: SoundcheckErrorCode) {
    super(FAILURE_MESSAGES[code]);
  }
}

/** A linked video's length and privacy, from `videos.list`. */
export interface LinkedVideo {
  durationS: number;
  privacyStatus: string | null;
}

/** The outside world, replaceable in tests. */
export interface SoundcheckDeps {
  probeUpload: (uri: string) => Promise<ProbedFile>;
  lookupVideo: (
    channelId: string,
    videoId: string,
    soundcheckId: string,
  ) => Promise<LinkedVideo | null>;
  extract: (target: ExtractionTarget, options: ExtractOptions) => Promise<ExtractionOutcome>;
  readChannel: (channelId: string) => Promise<ChannelForCut>;
  chapters: typeof titleChapters;
}

/** The video through the channel's own credentials, which also see its unlisted and private ones. */
async function lookupVideo(
  channelId: string,
  videoId: string,
  soundcheckId: string,
): Promise<LinkedVideo | null> {
  const auth = await credentialsForChannel(channelId);
  const body = await fetchVideos(auth, videosRequest([videoId]));
  await archiveRaw({
    channelId,
    bucket: pickServerEnv(["GCS_UPLOADS_BUCKET"]).GCS_UPLOADS_BUCKET,
    source: "soundcheck-youtube",
    key: soundcheckId,
    body,
  });
  const [video] = parseVideos(body);
  return video ? { durationS: video.durationS, privacyStatus: video.privacyStatus } : null;
}

const defaultDeps: SoundcheckDeps = {
  probeUpload: (uri) => probeUpload(uri),
  lookupVideo,
  extract: extractVideoBeats,
  readChannel: readChannelForCut,
  chapters: titleChapters,
};

export type SoundcheckRunResult =
  | { soundcheckId: string; status: "ready"; durationS: number; beats: number }
  | { soundcheckId: string; status: "failed"; code: SoundcheckErrorCode }
  | { soundcheckId: string; status: "skipped"; reason: string };

/** Takes the soundcheck for this run, or says why not. */
async function claim(
  path: string,
  now: Date,
): Promise<{ doc: SoundcheckDoc } | { skipped: string }> {
  const db = getFirestore();
  const ref = db.doc(path);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { skipped: "no such soundcheck" };
    const doc = soundcheckDocSchema.parse(snapshot.data());
    if (doc.status === "ready") return { skipped: "already finished" };
    if (doc.status === "running" && now.getTime() - Date.parse(doc.updatedAt) < STALE_AFTER_MS) {
      return { skipped: "already running" };
    }
    const running = soundcheckDocSchema.parse({
      ...doc,
      status: "running",
      error: null,
      progress: progressAt("checking", "Checking your video"),
      updatedAt: now.toISOString(),
    });
    tx.set(ref, running);
    return { doc: running };
  });
}

function progressAt(step: SoundcheckStep, message: string, finished = false) {
  const index = STEPS.indexOf(step);
  return { step, message, done: finished ? index + 1 : index, total: STEPS.length };
}

export async function runSoundcheck({
  channelId,
  soundcheckId,
  runId,
  now = () => new Date(),
  log = rootLogger,
  deps = defaultDeps,
}: {
  channelId: string;
  soundcheckId: string;
  runId?: string;
  now?: () => Date;
  log?: Logger;
  deps?: SoundcheckDeps;
}): Promise<SoundcheckRunResult> {
  const runLog = childLogger(
    {
      channel_id: channelId,
      soundcheck_id: soundcheckId,
      stage: SOUNDCHECK_STEP,
      ...(runId ? { run_id: runId } : {}),
    },
    log,
  );
  const paths = soundcheckPaths(channelId);
  const ref = getFirestore().doc(paths.soundcheck(soundcheckId));
  const claimed = await claim(paths.soundcheck(soundcheckId), now());
  if ("skipped" in claimed) {
    runLog.info({ reason: claimed.skipped }, "soundcheck skipped");
    return { soundcheckId, status: "skipped", reason: claimed.skipped };
  }
  let doc = claimed.doc;
  // Logged at each step, so a run's time can be split into start-up, Gemini and the rest.
  runLog.info({ kind: doc.input.kind, scenario: doc.scenario }, "soundcheck started");
  /** Saves a change to the document, validated (rule 3). */
  const save = async (change: Partial<SoundcheckDoc>) => {
    doc = soundcheckDocSchema.parse({ ...doc, ...change, updatedAt: now().toISOString() });
    await ref.set(doc);
  };

  try {
    // 1. Checking.
    let durationS: number;
    let target: ExtractionTarget;
    const { input } = doc;
    if (input.kind === "file") {
      const probed = await deps.probeUpload(input.uri);
      if (!probed.hasVideo) throw new SoundcheckFailure("unsupported_type");
      durationS = probed.durationS;
      target = {
        channelId,
        videoId: soundcheckId,
        durationS,
        privacyStatus: null,
        sourceUri: input.uri,
      };
    } else {
      const video = await deps.lookupVideo(channelId, input.videoId, soundcheckId);
      if (!video) throw new SoundcheckFailure("video_unavailable");
      if (video.privacyStatus === "private") throw new SoundcheckFailure("private_video");
      durationS = video.durationS;
      target = { channelId, videoId: input.videoId, durationS, privacyStatus: video.privacyStatus };
    }
    if (durationS < SOUNDCHECK_LIMITS.minDurationS) throw new SoundcheckFailure("too_short");
    if (durationS > SOUNDCHECK_LIMITS.maxDurationS) throw new SoundcheckFailure("too_long");
    runLog.info({ duration_s: durationS }, "checked");
    await save({ durationS, progress: progressAt("watching", "Watching your video") });

    // 2. Watching.
    const outcome = await deps.extract(target, {
      noCache: true,
      writeCache: false,
      archive: {
        source: "soundcheck-beats",
        label: soundcheckId,
        bucket: pickServerEnv(["GCS_UPLOADS_BUCKET"]).GCS_UPLOADS_BUCKET,
      },
      log: runLog,
    });
    if (outcome.status === "private_unavailable") throw new SoundcheckFailure("private_video");
    if (outcome.status === "invalid") throw new SoundcheckFailure("unreadable");
    if (!outcome.extraction) {
      throw new Error(`Extraction ${outcome.status}: ${outcome.errors.join("; ")}`);
    }
    const extraction = outcome.extraction.beats;
    const beats = displayBeats(extraction.beats);
    runLog.info(
      {
        beats: beats.length,
        // Not `tokens`: the logger redacts any key ending in token(s).
        prompt_token_count: outcome.usage.prompt_tokens,
        cost_usd: outcome.usage.cost_usd,
      },
      "watched",
    );
    await save({
      beats,
      progress: progressAt(
        "predicting",
        `Found ${beats.length} beat${beats.length === 1 ? "" : "s"}. Predicting how your audiences will watch`,
      ),
    });

    // 3. Predicting.
    const channel = await deps.readChannel(channelId);
    const models: Partial<Record<MeasuredAudience, CutModel>> = {};
    for (const audience of MEASURED) {
      const model = channel.models[audience];
      if (model) models[audience] = { artifact: model.artifact, inflation: model.inflation };
    }
    if (!models.subscribed && !models.unsubscribed) throw new SoundcheckFailure("no_model");
    const fallbackMix = channel.models.unsubscribed?.artifact.channelContext?.mixMean ?? {
      search: 0,
      suggested: 0,
      browse: 0,
    };
    const audienceMix = scenarioAudienceMix(
      doc.scenario,
      recentAudienceMix(channel.recent, fallbackMix),
    );
    const predicted = predictCut(extraction, durationS, models, audienceMix, {
      seed: SOUNDCHECK_SEED,
    });
    const prediction = predictionDoc(predicted, channel.models, channel.recentAvp);
    await save({
      progress: progressAt("suggesting", "Trying edits that could keep viewers longer"),
    });

    // 4. Suggesting: edits on the prediction's own draws, and chapter titles.
    const usable = Object.values(prediction.audiences).every((audience) => audience.model.usable);
    const search = searchEdits(
      cutSampler(models, { seed: SOUNDCHECK_SEED, draws: CUT_DRAWS }),
      Object.fromEntries(Object.entries(models).map(([key, model]) => [key, model.artifact])),
      { video: extraction, durationS },
      audienceMix,
      { usable },
    );
    const chapters = await deps.chapters(
      {
        channelId,
        soundcheckId,
        beats: extraction.beats.map((beat) => ({
          startS: beat.start_s,
          endS: beat.end_s,
          type: beat.beat_type,
          summary: beat.summary,
        })),
        videoSummary: extraction.video_summary,
      },
      { log: runLog },
    );
    runLog.info(
      {
        edits: search.edits.length,
        recommended: search.edits.filter((edit) => edit.recommended).length,
        chapters: chapters?.length ?? 0,
      },
      "suggested",
    );

    // 5. Finishing.
    const finishedAt = now().toISOString();
    const inputs = soundcheckInputsSchema.parse(
      inputsDoc({
        soundcheckId,
        channelId,
        durationS,
        extraction,
        scenario: doc.scenario,
        audienceMix,
        prediction,
        models: channel.models,
        seed: SOUNDCHECK_SEED,
        createdAt: finishedAt,
      }),
    );
    doc = soundcheckDocSchema.parse({
      ...doc,
      status: "ready",
      prediction,
      edits: editsDoc(search.edits),
      recommendedEffect: effectDoc(search.together),
      chapters,
      narrative: narrative(prediction),
      extractionVersion: EXTRACTION_VERSION,
      progress: progressAt("finishing", "Done", true),
      updatedAt: finishedAt,
    });
    const batch = getFirestore().batch();
    batch.set(getFirestore().doc(paths.inputs(soundcheckId)), inputs);
    batch.set(ref, doc);
    await batch.commit();
    runLog.info(
      {
        duration_s: durationS,
        avp_p50: prediction.avp.p50,
        usable: Object.values(prediction.audiences).every((audience) => audience.model.usable),
      },
      "soundcheck ready",
    );
    return { soundcheckId, status: "ready", durationS, beats: beats.length };
  } catch (error) {
    const code = error instanceof SoundcheckFailure ? error.code : "internal";
    await save({
      status: "failed",
      error: { code, message: FAILURE_MESSAGES[code] },
    });
    if (code !== "internal") {
      runLog.info({ code }, "soundcheck failed");
      return { soundcheckId, status: "failed", code };
    }
    runLog.error({ err: (error as Error).message }, "soundcheck failed unexpectedly");
    throw error;
  }
}
