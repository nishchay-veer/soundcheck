import { AUDIENCE_LABELS, type AudienceKey, type ModelStamp } from "@soundcheck/core/schemas";

/** Which audiences' models a screen's numbers can be trusted for, and why the others can't yet. */
export interface ModelStanding {
  /** Each audience whose model is not usable yet, with its reasons. */
  notUsable: { label: string; reasons: string[] }[];
  /** The audiences whose model is usable: their numbers are real results. */
  usable: string[];
}

/** From each audience's label and model stamp; an audience without a model is in neither list. */
export function modelStanding(
  audiences: Iterable<{ label: string; model: ModelStamp | null | undefined }>,
): ModelStanding {
  const standing: ModelStanding = { notUsable: [], usable: [] };
  for (const { label, model } of audiences) {
    if (!model) continue;
    if (model.usable) standing.usable.push(label);
    else standing.notUsable.push({ label, reasons: model.unusableReasons });
  }
  return standing;
}

/** The same, for audiences keyed by audience (a video's or a soundcheck's). */
export function standingOf(
  audiences: Partial<Record<AudienceKey, { model: ModelStamp | null } | undefined>>,
): ModelStanding {
  return modelStanding(
    (Object.keys(audiences) as AudienceKey[]).flatMap((key) => {
      const audience = audiences[key];
      return audience ? [{ label: AUDIENCE_LABELS[key], model: audience.model }] : [];
    }),
  );
}
