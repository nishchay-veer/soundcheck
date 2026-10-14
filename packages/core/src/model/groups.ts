import type { AttributionGroup } from "../schemas";
import { POSITION_FEATURES } from "./config";

/**
 * The human cause each model column belongs to (Phase 11's drop-off
 * attribution, and Phase 15's edit reasons): content features by what they
 * describe, position terms as "position in video".
 */

/** The group each content feature (and its traffic-mix interactions) belongs to. */
export const FEATURE_GROUPS: Readonly<Record<string, AttributionGroup>> = {
  beat_sponsor: "sponsor",
  beat_intro_branding: "branded_intro",
  beat_cta: "call_to_action",
  beat_tangent: "tangent",
  beat_recap: "recap",
  beat_payoff: "payoff",
  before_payoff: "payoff",
  has_open_loop: "payoff",
  static_talking_head_share: "no_visual_change",
  log1p_static_run_s: "no_visual_change",
  log1p_cuts_per_min: "no_visual_change",
  visual_b_roll: "visuals",
  visual_screen_recording: "visuals",
  on_screen_text: "on_screen_text",
  energy: "energy",
  info_density: "pace",
  speech_wpm: "pace",
  knowledge_gap: "knowledge_gap",
  log1p_secs_in_current_beat: "long_beat",
  music_fg: "music",
};

const POSITION = new Set(POSITION_FEATURES);
const INTERACTION = /^ix_(.+)_(search|suggested|browse)$/;
const MIX = /^mix_(search|suggested|browse)$/;

/**
 * The group a model column is attributed to, or null for the traffic mix,
 * which is the same in every bin of a video and so never explains a drop-off.
 */
export function groupOf(feature: string): AttributionGroup | null {
  if (POSITION.has(feature)) return "position";
  if (MIX.test(feature)) return null;
  const base = INTERACTION.exec(feature)?.[1] ?? feature;
  const group = FEATURE_GROUPS[base];
  if (!group) throw new Error(`No attribution group for model column "${feature}"`);
  return group;
}
