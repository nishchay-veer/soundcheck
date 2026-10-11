import { formatClock, type NarrationItem } from "@soundcheck/core/gemini";
import {
  AUDIENCE_LABELS,
  type AudienceCard,
  type MeasuredAudience,
  type ModelStamp,
  type SummaryEvaluation,
} from "@soundcheck/core/schemas";
import type { DropAttribution } from "./attribution";
import type { DropSpan } from "./drops";

/**
 * What Gemini is told about each drop-off, audience card and the channel
 * headline, and the template used when its caption fails the checks
 * (`narrate` in core). Numbers are formatted here, once, exactly as a caption
 * may repeat them. A model that is not usable contributes no causes or
 * traits, so no caption can present them as findings; the screens carry the
 * "not a result yet" warning, not every caption.
 */

export const NARRATION_WORDS = { drop: 40, audience: 30, headline: 25 } as const;
/** Causes named per drop-off, at most. */
const CAUSES = 3;

/** Percentage points with one decimal: "6.4". */
const points = (value: number) => value.toFixed(1);
/** A share as a whole percentage: "55". */
const percent = (share: number) => String(Math.round(share * 100));
const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

export function dropNarration(
  id: string,
  {
    audience,
    span,
    attribution,
    model,
  }: {
    audience: MeasuredAudience;
    span: DropSpan;
    attribution: DropAttribution;
    model: ModelStamp | null;
  },
): NarrationItem {
  const label = AUDIENCE_LABELS[audience];
  const start = formatClock(span.startS);
  const end = formatClock(span.endS);
  const lost = points(span.actualLossPp);
  const causes = model?.usable
    ? attribution.attributions
        .filter((a) => Number(percent(a.share)) >= 1)
        .slice(0, CAUSES)
        .map((a) => ({ cause: lower(a.label), percent: percent(a.share) }))
    : [];
  const top = causes[0];
  return {
    id,
    kind: "drop",
    maxWords: NARRATION_WORDS.drop,
    facts: {
      audience: label,
      start,
      end,
      startersLostPercent: lost,
      ...(causes.length ? { causes, unexplainedPercent: percent(attribution.residualShare) } : {}),
    },
    fallback:
      `${lost}% of ${lower(label)} who started the video left between ${start} and ${end}.` +
      (top ? ` The model's top cause: ${top.cause} (${top.percent}%).` : ""),
  };
}

export function audienceNarration(card: Omit<AudienceCard, "description">): NarrationItem {
  const share = percent(card.viewShare);
  const average = card.avgViewPct === null ? null : points(card.avgViewPct);
  return {
    id: `audience:${card.key}`,
    kind: "audience",
    maxWords: NARRATION_WORDS.audience,
    facts: {
      audience: card.label,
      measured: card.kind === "measured",
      viewSharePercent: share,
      ...(card.watchTimeShare === null
        ? {}
        : { watchTimeSharePercent: percent(card.watchTimeShare) }),
      ...(average === null ? {} : { averageViewPercent: average }),
      ...(card.model.usable && card.traits.length
        ? { traits: card.traits.map((t) => ({ trait: t.statement, points: points(t.deltaPp) })) }
        : {}),
    },
    fallback:
      `${card.label} bring ${share}% of your views` +
      (average === null ? "." : ` and watch ${average}% of a video on average.`),
  };
}

export function headlineNarration({
  videosAnalysed,
  cards,
  evaluation,
}: {
  videosAnalysed: number;
  cards: readonly Pick<AudienceCard, "label" | "kind" | "viewShare" | "avgViewPct">[];
  evaluation: SummaryEvaluation | null;
}): NarrationItem {
  const measured = cards.filter((card) => card.kind === "measured" && card.avgViewPct !== null);
  const videos = `${videosAnalysed} video${videosAnalysed === 1 ? "" : "s"}`;
  const watching = measured.map(
    (card) => `${lower(card.label)} watch ${points(card.avgViewPct as number)}%`,
  );
  return {
    id: "headline",
    kind: "headline",
    maxWords: NARRATION_WORDS.headline,
    facts: {
      videosAnalysed,
      audiences: cards.map((card) => ({
        audience: card.label,
        viewSharePercent: percent(card.viewShare),
        ...(card.avgViewPct === null ? {} : { averageViewPercent: points(card.avgViewPct) }),
      })),
      ...(evaluation
        ? {
            evaluation: {
              modelErrorPoints: points(evaluation.modelErrorPp),
              baselineErrorPoints: points(evaluation.baselineErrorPp),
              beatsChannelAverage: evaluation.beatsBaseline,
            },
          }
        : {}),
    },
    fallback: watching.length
      ? `Across ${videos}, ${watching.join(" and ")} of a video on average.`
      : `${videos} analysed.`,
  };
}
