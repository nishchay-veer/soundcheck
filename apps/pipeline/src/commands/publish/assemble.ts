import { buildBins, type FeatureFrame } from "@soundcheck/core/features";
import type { Narration, NarrationItem } from "@soundcheck/core/gemini";
import { sampleCurves, type Trait } from "@soundcheck/core/model";
import {
  AUDIENCE_LABELS,
  audienceCardSchema,
  summaryDocSchema,
  videoDocSchema,
  videoIndexDocSchema,
  type AudienceCard,
  type Band,
  type Drop,
  type Effect,
  type MeasuredAudience,
  type ModelArtifact,
  type ModelStamp,
  type SummaryDoc,
  type SummaryEvaluation,
  type TraitCard,
  type VideoAudience,
  type VideoDoc,
  type VideoIndexDoc,
} from "@soundcheck/core/schemas";
import type { TraitsResult } from "../traits/run";
import { attributeDrop, type DropAttribution } from "./attribution";
import { findDrops } from "./drops";
import { audienceNarration, dropNarration, headlineNarration } from "./narrate";
import type { PublishInputs, StatusStats } from "./read";

/**
 * Builds every serving document of a channel from what `publish` read
 * (Phase 11), leaving the captions to narration: drafts first, then
 * `finalize` fills in the captions and checks each document's schema.
 */

const MEASURED: readonly MeasuredAudience[] = ["subscribed", "unsubscribed"];
/** Traits shown per card. */
const TRAITS = 3;

const round = (value: number, places: number) => Number(value.toFixed(places));

/**
 * A drop-off's attribution shares as published: each rounded down to 4
 * places, so together they never pass 1, and the residual takes the rest.
 * Rounding to the nearest once made three shares of a fully explained drop
 * add up to 1.0001, which the drop schema refuses (Oct 16, 2026).
 */
export function publishedShares<T extends { share: number }>(
  attributions: readonly T[],
): { attributions: T[]; residualShare: number } {
  const rounded = attributions
    .map((attribution) => ({ ...attribution, share: Math.floor(attribution.share * 1e4) / 1e4 }))
    .filter((attribution) => attribution.share > 0);
  const explained = rounded.reduce((sum, attribution) => sum + attribution.share, 0);
  return { attributions: rounded, residualShare: Math.max(0, 1 - explained) };
}
/** Survival to 4 places (0.01 points); rounding keeps the percentiles in order. */
const curve = (values: ArrayLike<number>) =>
  Array.from(values, (value) => round(Math.min(1, Math.max(0, value)), 4));

export function modelStamp(model: ModelArtifact): ModelStamp {
  return {
    runId: model.runId,
    usable: model.usable,
    unusableReasons: model.unusableReasons,
    trainedVideos: model.trainVideoIds.length,
  };
}

/**
 * The latest held-out evaluation as the summary shows it, for all viewers,
 * and each audience's band inflation. Only an evaluation of the models being
 * published counts; one of an older fit is left out.
 */
export function holdoutResults(inputs: Pick<PublishInputs, "evaluation" | "models">): {
  evaluation: SummaryEvaluation | null;
  inflation: Partial<Record<MeasuredAudience, number>>;
} {
  const held = inputs.evaluation;
  const production = inputs.models.get("all")?.runId;
  if (!held || held.modelRunId !== production) return { evaluation: null, inflation: {} };
  const inflation: Partial<Record<MeasuredAudience, number>> = {};
  for (const audience of MEASURED) {
    const factor = held.details.audiences[audience]?.inflation?.factor;
    if (factor !== undefined) inflation[audience] = factor;
  }
  const all = held.details.audiences.all;
  const model = all?.summary.model;
  const baseline = all?.summary[all.b0_variant === "channel average" ? "b0_channel" : "b0_length"];
  const evaluation =
    all && model && baseline && model.videos > 0
      ? {
          runId: held.runId,
          testVideos: model.videos,
          modelErrorPp: round(model.curve_mae_pp, 2),
          baselineErrorPp: round(baseline.curve_mae_pp, 2),
          beatsBaseline: all.bootstrap?.beats_b0 ?? false,
        }
      : null;
  return { evaluation, inflation };
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A trait as a card shows it, or null unless its interval excludes zero. */
function traitCard(trait: Trait): TraitCard | null {
  if (!trait.measured || trait.deltaPp === null || trait.ciLow === null || trait.ciHigh === null) {
    return null;
  }
  const [low, high] = [round(trait.ciLow, 2), round(trait.ciHigh, 2)];
  if (!(low > 0 || high < 0)) return null;
  const delta = round(trait.deltaPp, 2);
  return {
    feature: trait.feature,
    statement: `${sentence(trait.condition)}: ${delta > 0 ? "+" : ""}${delta.toFixed(1)} points still watching at the end`,
    deltaPp: delta,
    ci: [low, high],
  };
}

/** The strongest traits by absolute effect, among those whose interval excludes zero. */
export function topTraits(traits: readonly Trait[]): TraitCard[] {
  return traits
    .map(traitCard)
    .filter((card): card is TraitCard => card !== null)
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp) || a.feature.localeCompare(b.feature))
    .slice(0, TRAITS);
}

/**
 * Every simulated effect for an audience's sheet: measured ones by absolute
 * size, then those the model never learned, by label.
 */
export function effectRows(traits: readonly Trait[]): Effect[] {
  const rows = traits.map((trait): Effect => {
    const learned =
      trait.measured && trait.deltaPp !== null && trait.ciLow !== null && trait.ciHigh !== null;
    return {
      feature: trait.feature,
      label: sentence(trait.condition),
      deltaPp: learned ? round(trait.deltaPp as number, 2) : null,
      ci: learned ? [round(trait.ciLow as number, 2), round(trait.ciHigh as number, 2)] : null,
    };
  });
  const size = (effect: Effect) => (effect.deltaPp === null ? -1 : Math.abs(effect.deltaPp));
  return rows.sort((a, b) => size(b) - size(a) || a.label.localeCompare(b.label));
}

type CardDraft = Omit<AudienceCard, "description">;
type DropDraft = Omit<Drop, "narrative"> & { narrationId: string };
type VideoDraft = Omit<VideoDoc, "drops"> & { drops: DropDraft[] };

export interface Draft {
  summary: Omit<SummaryDoc, "headline" | "audiences"> & { audiences: CardDraft[] };
  index: VideoIndexDoc;
  videos: VideoDraft[];
  /** What to narrate: one batch for the channel, one per video with drop-offs. */
  batches: NarrationItem[][];
}

export interface PublishOptions {
  channelId: string;
  runId: string;
  generatedAt: string;
  draws: number;
  seed: number;
}

/**
 * Totals over all viewers: views, average view duration and YouTube's average
 * view percentage (weighted by views; from the duration if YouTube gave none).
 */
export function videoStats(
  byStatus: Partial<Record<MeasuredAudience, StatusStats>> | undefined,
  durationS: number,
) {
  const rows = MEASURED.flatMap((audience) => (byStatus?.[audience] ? [byStatus[audience]] : []));
  const views = rows.reduce((sum, row) => sum + row.views, 0);
  if (views === 0) return null;
  const minutes = rows.reduce((sum, row) => sum + row.minutesWatched, 0);
  const weighted = rows.filter((row) => row.avp !== null && row.views > 0);
  const weightedViews = weighted.reduce((sum, row) => sum + row.views, 0);
  const avdS = (minutes * 60) / views;
  return {
    views,
    avdS: round(avdS, 1),
    avp: round(
      weightedViews
        ? weighted.reduce((sum, row) => sum + row.views * (row.avp as number), 0) / weightedViews
        : (avdS / durationS) * 100,
      1,
    ),
  };
}

/** The documents of a channel, without captions, and what to narrate. */
export function assemble(
  inputs: PublishInputs,
  traits: TraitsResult | null,
  options: PublishOptions,
): Draft {
  const { channelId, runId, generatedAt, draws, seed } = options;
  const { features, models } = inputs;
  const { evaluation, inflation } = holdoutResults(inputs);
  const trained = new Set([...models.values()].flatMap((model) => model.trainVideoIds));
  const batches: NarrationItem[][] = [];

  const videos: VideoDraft[] = inputs.videos.map((video) => {
    const extraction = features.extractions.get(video.videoId);
    const curves = features.curves.get(video.videoId);
    const audiences: Partial<Record<MeasuredAudience, VideoAudience>> = {};
    const drops: DropDraft[] = [];
    const items: NarrationItem[] = [];

    for (const audience of MEASURED) {
      const points = curves?.get(audience);
      const model = models.get(audience);
      const context = model?.channelContext;
      const frame: FeatureFrame | null =
        model && context && extraction
          ? buildBins(
              extraction,
              video.durationS,
              context,
              audience === "unsubscribed"
                ? (features.newcomerMix.get(video.videoId) ?? context.mixMean)
                : null,
            )
          : null;
      const sampled =
        model && frame ? sampleCurves(model, frame, draws, seed, inflation[audience] ?? 1) : null;
      const predicted: Band | null = sampled
        ? { p10: curve(sampled.p10), p50: curve(sampled.p50), p90: curve(sampled.p90) }
        : null;
      const actual = points ? curve(points.map((point) => point.sMono)) : null;
      if (!actual && !predicted) continue;
      const stamp = model && predicted ? modelStamp(model) : null;
      audiences[audience] = { actual, predicted, model: stamp };

      if (!points || !actual) continue;
      for (const span of findDrops(actual, video.durationS)) {
        const attribution: DropAttribution =
          model && frame
            ? attributeDrop(
                model,
                frame,
                points.map((point) => point.hazard),
                span,
              )
            : { attributions: [], residualShare: 1 };
        const narrationId = `${video.videoId}:${audience}:${span.binStart}`;
        const { attributions, residualShare } = publishedShares(attribution.attributions);
        drops.push({
          audience,
          binStart: span.binStart,
          binEnd: span.binEnd,
          startS: round(span.startS, 1),
          endS: round(span.endS, 1),
          actualLossPp: round(span.actualLossPp, 2),
          attributions,
          residualShare,
          narrationId,
        });
        items.push(dropNarration(narrationId, { audience, span, attribution, model: stamp }));
      }
    }
    if (items.length) batches.push(items);

    return {
      channelId,
      videoId: video.videoId,
      runId,
      generatedAt,
      title: video.title,
      publishedAt: video.publishedAt,
      durationS: video.durationS,
      thumbnailUrl: video.thumbnailUrl,
      stats: videoStats(inputs.stats.get(video.videoId), video.durationS),
      audiences,
      beats: inputs.beats.get(video.videoId) ?? [],
      drops,
      inSample: trained.has(video.videoId),
    };
  });

  const index: VideoIndexDoc = {
    channelId,
    runId,
    generatedAt,
    videos: videos.map((video) => {
      const biggest = [...video.drops].sort((a, b) => b.actualLossPp - a.actualLossPp)[0];
      return {
        videoId: video.videoId,
        title: video.title,
        publishedAt: video.publishedAt,
        durationS: video.durationS,
        thumbnailUrl: video.thumbnailUrl,
        avgViewPct: video.stats?.avp ?? null,
        biggestDrop: biggest
          ? { audience: biggest.audience, atS: biggest.startS, lossPp: biggest.actualLossPp }
          : null,
        inSample: video.inSample,
      };
    }),
  };

  const cards = audienceCards(inputs, traits);
  const analysed = videos.filter((video) => video.beats.length > 0);
  const summary = {
    channelId,
    runId,
    generatedAt,
    videosAnalysed: analysed.length,
    beatsExtracted: analysed.reduce((sum, video) => sum + video.beats.length, 0),
    evaluation,
    audiences: cards,
  };
  batches.unshift([
    ...cards.map(audienceNarration),
    headlineNarration({ videosAnalysed: summary.videosAnalysed, cards, evaluation }),
  ]);
  return { summary, index, videos, batches };
}

/** Subscribers and newcomers, then any estimated audience the identifiability rule shows. */
function audienceCards(inputs: PublishInputs, traits: TraitsResult | null): CardDraft[] {
  const totals = { views: 0, minutes: 0 };
  const per = Object.fromEntries(
    MEASURED.map((audience) => [audience, { views: 0, minutes: 0, avpViews: 0, avpSum: 0 }]),
  ) as Record<
    MeasuredAudience,
    { views: number; minutes: number; avpViews: number; avpSum: number }
  >;
  const fromSource = { search: 0, suggested: 0, browse: 0 };
  for (const video of inputs.videos) {
    const byStatus = inputs.stats.get(video.videoId);
    for (const audience of MEASURED) {
      const row = byStatus?.[audience];
      if (!row) continue;
      per[audience].views += row.views;
      per[audience].minutes += row.minutesWatched;
      totals.views += row.views;
      totals.minutes += row.minutesWatched;
      if (row.avp !== null) {
        per[audience].avpViews += row.views;
        per[audience].avpSum += row.views * row.avp;
      }
    }
    const mix = inputs.features.newcomerMix.get(video.videoId);
    const newcomerViews = byStatus?.unsubscribed?.views ?? 0;
    if (mix) {
      for (const source of Object.keys(fromSource) as (keyof typeof fromSource)[]) {
        fromSource[source] += newcomerViews * mix[source];
      }
    }
  }
  if (totals.views === 0) return [];

  const traitsOf = (audience: MeasuredAudience) =>
    traits?.audiences.find((entry) => entry.audience === audience)?.traits ?? [];
  const measured: CardDraft[] = MEASURED.map((audience) => {
    const model = inputs.models.get(audience);
    return {
      key: audience,
      label: AUDIENCE_LABELS[audience],
      kind: "measured",
      viewShare: round(per[audience].views / totals.views, 4),
      watchTimeShare: totals.minutes > 0 ? round(per[audience].minutes / totals.minutes, 4) : null,
      avgViewPct:
        per[audience].avpViews > 0 ? round(per[audience].avpSum / per[audience].avpViews, 1) : null,
      traits: model ? topTraits(traitsOf(audience)) : [],
      effects: model ? effectRows(traitsOf(audience)) : [],
      model: model ? modelStamp(model) : null,
    };
  });
  const newcomers = inputs.models.get("unsubscribed");
  const estimated: CardDraft[] = newcomers
    ? (traits?.estimated ?? [])
        .filter((audience) => audience.shown)
        .map((audience) => ({
          key: audience.source,
          label: AUDIENCE_LABELS[audience.source],
          kind: "estimated",
          viewShare: round(fromSource[audience.source] / totals.views, 4),
          watchTimeShare: null,
          avgViewPct: null,
          traits: topTraits(audience.traits),
          effects: effectRows(audience.traits),
          model: modelStamp(newcomers),
        }))
    : [];
  return [...measured, ...estimated];
}

/** The finished documents, each checked against its schema. */
export function finalize(
  draft: Draft,
  narrations: ReadonlyMap<string, Narration>,
): { summary: SummaryDoc; index: VideoIndexDoc; videos: VideoDoc[] } {
  const text = (id: string) => {
    const narration = narrations.get(id);
    if (!narration) throw new Error(`No caption for ${id}`);
    return narration.text;
  };
  const audiences = draft.summary.audiences.map((card) =>
    audienceCardSchema.parse({ ...card, description: text(`audience:${card.key}`) }),
  );
  return {
    summary: summaryDocSchema.parse({ ...draft.summary, audiences, headline: text("headline") }),
    index: videoIndexDocSchema.parse(draft.index),
    videos: draft.videos.map((video) =>
      videoDocSchema.parse({
        ...video,
        drops: video.drops.map(({ narrationId, ...drop }) => ({
          ...drop,
          narrative: text(narrationId),
        })),
      }),
    ),
  };
}
