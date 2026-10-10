# Phase 07: Timeline and training table

Oct 10, 2026

Every usable video now has a training row per audience and bin in BigQuery: the measured hazard as the label, viewers at risk and views as weights, and an 86-number feature vector built by the TypeScript featurizer that predictions will also use.

- **Feature version:** `feat-bf1e3064fa6f`.
- **Test channel:** 900 rows (3 videos × 3 audiences × 100 bins).
- **Data gate:** still not met, so the exploratory analysis checks the plumbing rather than measuring effects.

Built in five reviewed commits:

1. `Add the feature spec and spline basis`
2. `Build the 100-bin feature frame`
3. `Write training bins to BigQuery`
4. `Add exploratory analysis of the training table`
5. `Verify Phase 07 and write the notes`

## Done when

| Item                                                                                       | Status           | Evidence                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training_bins` populated for every usable channel (about 100 rows per video per audience) | Done (1 channel) | `soundcheck features --channel UC-BHlgFbFh3V76yth-XCmlw`: 900 rows, 100 per video per audience, each `x` 86 long. All 900 hazards equal `retention_curves` exactly (a join found 0 mismatches). The Short is left out as not eligible for training. Only one channel is connected |
| Golden, property, spline cross-check, leakage and determinism tests pass                   | Done             | `packages/core/src/features/`: a golden 3-beat video, random-video and spline property tests, scipy cross-check (worst difference 1.1e-16 against the 1e-12 limit), leakage, version hash and byte-identical frames                                                               |
| EDA summarized in the notes, with the five features most correlated with hazard            | Done             | "Exploratory analysis" below; full report in `docs/eda/feat-bf1e3064fa6f/`                                                                                                                                                                                                        |
| `docs/notes/phase-07.md` written                                                           | Done             | This file                                                                                                                                                                                                                                                                         |

Also verified:

- **`feature_specs`** holds one row for `feat-bf1e3064fa6f`, with 86 features and revision 1.
- **A second `features` run** reported "unchanged since the last run" and wrote nothing.
- **`pnpm check`** passes all 20 tasks: core 442 tests, pipeline 129, web 24, ui 4, modeling 13.

## Live run

```
Features for UC-BHlgFbFh3V76yth-XCmlw (feat-bf1e3064fa6f, beats beats-v5, data through 2026-10-03)
  Quality gate: passed (report a9f0a1eb53da4f6e8783703d3b656dbe)
  Videos: 3 used, 1 skipped
    zSOdb1KzLO8: not eligible for training
  Rows: 900 (all 300, subscribed 300, unsubscribed 300), 86 features each
  Channel context: median target level 1; newcomer mix mean search 0.16, suggested 0.07, browse 0.51
  Newcomer mix missing: none
  training_bins: written
```

Viewers at risk summed over all bins:

| Audience     | Viewers at risk |
| ------------ | --------------- |
| all          | 46,558          |
| subscribed   | 9,170           |
| unsubscribed | 36,920          |

## Exploratory analysis

`uv run --env-file ../../.env soundcheck-modeling eda`, Oct 10, 2026. Read it with care. The channel has 3 usable videos where the data gate asks for 40. Two are music performances and one is the 88-second application video. With so few videos, a correlation mostly separates one video from another rather than measuring an effect.

The five content features most correlated with hazard (Spearman over every bin of the audience; Pearson weighted by viewers at risk in brackets):

| Audience     | 1                             | 2                            | 3                                  | 4                                          | 5                               |
| ------------ | ----------------------------- | ---------------------------- | ---------------------------------- | ------------------------------------------ | ------------------------------- |
| all          | `before_payoff` +0.22 (+0.44) | `info_density` −0.12 (−0.25) | `has_open_loop` −0.12 (−0.25)      | `beat_setup` −0.11 (−0.15)                 | `beat_end_screen` +0.09 (+0.19) |
| subscribed   | `before_payoff` +0.29 (+0.38) | `silence` +0.19 (+0.31)      | `log1p_static_run_s` −0.16 (−0.20) | `log1p_secs_in_current_beat` −0.13 (−0.20) | `speech_wpm` −0.13 (−0.23)      |
| unsubscribed | `before_payoff` +0.17         | `info_density` −0.10         | `beat_end_screen` +0.10            | `visual_graphics` +0.10                    | `visual_none` −0.10             |

- **`before_payoff` comes first for every audience.** Hazard is higher while the promise is still ahead. It is a plausible effect, but on these videos it is also simply the first few seconds of the two music covers, whose payoffs are at 10 s and 31 s.
- **Several features tie on the same value** (±0.09 among all viewers): `visual_graphics`, `visual_none`, `talking_head_share`, `static_talking_head_share`, `log1p_cuts_per_min` and `beat_end_screen`. They all pick out one beat: the 6-second end screen of the 3:42 music video, the only stretch of any video that isn't a person to camera. Viewers leave there because the video is ending, not because of graphics.
- **`format_performance`, `format_other` and `target_level`** (±0.09, "other features") pick out the application video, the only one that isn't a performance.
- **Missing data:**
  - no non-finite values;
  - every video has all three audiences;
  - 37 of 86 columns never vary on this channel: most beat types, 4 of 6 visuals, 10 of 12 formats, background music, and the sponsor and intro-branding interactions.
- **Mean hazard by bin** jumps between 0 and about 0.03 from bin to bin, because a curve built from about 40 to 340 viewers moves in steps. It is highest at the start (about 0.07 to 0.09 in bins 2 and 3) and the end (about 0.1 in bin 100).

## Decisions

By Nishchay, at planning:

- **The plan**, with the six interaction features taken from Phase 08's plan (sponsor share, intro-branding share, knowledge gap, log static run, information density, before payoff).
- **Spec fixes:**
  - `framing` replaced by `visual` shares and the talking-head features;
  - `log_duration` dropped;
  - clustering instead of partitioning;
  - a hash-based `FEATURE_VERSION`.
- **Features stored in the form the model uses them** (`log1p_*`, `has_open_loop`), because Python never computes a feature.
- **Python dependencies:** numpy, scipy, matplotlib and `google-cloud-bigquery` added to `services/modeling`. `db-dtypes` was left out because no pandas tables are used.
- **Building on one channel** with the data gate recorded as unmet, as in Phases 04 and 06.

## Changes from the spec

All are recorded in `docs/plan/phase-07.md`.

- **Picture features:**
  - "framing shares" became `visual_<value>` shares plus `talking_head_share` and `static_talking_head_share`;
  - `static_run_s` counts static talking-head beats: share 5 and at most 2 cuts a minute.
- **Stored transforms:**
  - `log1p_cuts_per_min`, `log1p_secs_in_current_beat` and `log1p_static_run_s` replace the raw values;
  - `has_open_loop` replaces the `open_loops` count (Phase 08 uses `open_loops > 0`).
- **`log_duration` is not a column.** It equals `log_bin_seconds` plus a constant, so the model couldn't tell the two apart.
- **`FEATURE_VERSION`** is a hash of the spec document. Besides the columns, the document covers:
  - the spline;
  - the interactions;
  - the bin count and static thresholds (`parameters`);
  - a hand-bumped `FEATURE_REVISION`.
- **`training_bins`:**
  - is clustered, not partitioned, by channel;
  - adds `extraction_version` and `as_of`;
  - uses the audience's own views for `video_views`.
- **Gaps between beats** are filled by stretching the neighbouring beats to their midpoint. A video without a newcomer mix gets the channel mean.
- **`features` checks the Phase 06 gate** and skips identical rewrites (step markers gained an optional input fingerprint).
- **The EDA report** goes to a folder per feature version, which Prettier skips. Rank correlation uses numpy, because scipy has no type information for mypy strict.
- **The leakage rule has one exception:** traffic-mix shares, on newcomer rows only. They come from Analytics but describe who arrived, not how they watched; the spec and the overview use them that way, and the code says why.

## Incidents

- **Off-by-one in a test:** the golden test checked `before_payoff` at slice 79 and 80 where the payoff boundary is between 80 and 81 (slices numbered from 1). The code was right.
- **Type errors found by checks:**
  - an array TypeScript inferred as `(0 | 1)[]` in the spline;
  - two Python variables reused with different types, caught by mypy.
- **Slow first Python test run:** 13 s, while matplotlib built its font cache. Later runs take under 1 s.
- **Table creation:** `03-bigquery.sh` grants IAM roles, so Nishchay ran it.
- **Not fixed (from earlier phases):** Prettier would change 12 files from earlier phases. They are the plan documents (`overview.md`, `design-system.md`) and the recorded YouTube fixtures. `pnpm check` doesn't run Prettier, so nothing fails, and they were left as they are.

## Notes for later phases

- **Phase 08 reads:**
  - `training_bins` where `feature_version` is the current `FEATURE_VERSION`;
  - the column names, in order, from `feature_specs.spec.features`.
- **Unpenalized columns:** the intercept and kind `spline` (`pos_b1` to `pos_b6`).
- **Weights:** `n_at_risk` within a video; `video_views` (the audience's views) for the `log(1 + views)` scaling across videos.
- **Phase 08's starting features**, by column name:
  - beat-type shares: `beat_sponsor`, `beat_intro_branding`, `beat_cta`, `beat_tangent`, `beat_recap`, `beat_payoff`;
  - `static_talking_head_share` (the plan's "talking_head_static share"; update that name in `phase-08.md`);
  - `log1p_static_run_s`, `log1p_cuts_per_min`, `on_screen_text`;
  - `energy`, `info_density`, `knowledge_gap`, `has_open_loop`, `before_payoff`;
  - `log1p_secs_in_current_beat`, `speech_wpm`, `music_fg`;
  - `visual_b_roll`, `visual_screen_recording`.

  The interactions are `ix_<feature>_<search|suggested|browse>`.

- **Constant columns:** standardizing by standard deviation divides by 0 for columns that never vary (37 of 86 here). Drop them per channel and audience, or keep them out of the fit.
- **Predictions need the channel context.** Store it (`medianTargetLevel` and `mixMean`) in the model artifact, or recompute it with `channelContext()` from the training videos; a new cut's frame must use the same one. For an estimated audience, pass a mix of 1 for that source and 0 for the others.
- **Spec changes:** changing a feature column changes `FEATURE_VERSION` (the hash test names the new value). Changing only a computation needs `FEATURE_REVISION` bumped. Either way, re-run `soundcheck features` for every channel, then `eda`.
- **Small channels have many zero hazards** (curves move in steps). That is fine for a fractional-response likelihood, but expect wide intervals.
- **Large channels:** `replaceChannelRows` builds the channel's whole NDJSON file in memory. Rows here average 619 bytes, and the largest is 874; channels with more varied content will be nearer the top. A 500-video channel (150,000 rows) would be about 90 to 130 MB, which is fine for a job but worth watching.
- **Data gate:** still at least two channels with 40+ usable videos; see `docs/notes/phase-04.md`.
