# Extraction quality

Oct 9, 2026 · extraction version `beats-v5` · Gemini 3.8 Flash on Vertex AI, static video mode

**Gemini's beat labels are consistent enough to train on.** Asked to label the same videos three times, it agrees with itself on every measure we gate on. A person who watched two of the videos judged all 40 of its beats correct.

## The gate

Six fixed videos (65 minutes: a tutorial, a vlog, a review, an explainer, a music performance and a Short), each extracted three times with a different seed at temperature 0. Every pair of runs is compared second by second, and the scores are averaged.

| Measure                             | What it checks                                                 | `beats-v5`                 | Needs     |
| ----------------------------------- | -------------------------------------------------------------- | -------------------------- | --------- |
| Boundary F1 (±3 s)                  | The runs cut the video in the same places                      | **0.76**                   | 0.70      |
| `beat_type` kappa                   | The same purpose label (hook, setup, demonstration, story…)    | **0.65**                   | 0.60      |
| `visual` kappa                      | The same kind of picture (screen recording, b-roll, graphics…) | **0.81**                   | 0.70      |
| `talking_head_share` weighted kappa | How much of a beat shows a person to camera, 1 to 5            | **0.70**                   | 0.50      |
| `energy` weighted kappa             | Delivery energy, 1 to 5                                        | **0.75**                   | 0.50      |
| `assumed_knowledge` weighted kappa  | Expertise assumed, 1 to 5                                      | **0.78**                   | 0.50      |
| `info_density` weighted kappa       | New information per minute, 1 to 5                             | **0.78**                   | 0.50      |
| Payoff time                         | When the title's promise is delivered                          | **0.2 s** apart on average | not gated |

Kappa is agreement beyond chance: 1 is perfect, 0 is what random labels would give. Weighted kappa counts a near miss (3 vs 4) as nearly right.

## Human agreement

A person watched the explainer (2:37) and the vlog (14:55) with Gemini's labels and **kept all 40 beats** (0 changed). A fresh Gemini run agreed with those confirmed labels at **kappa 0.68**: the same type for **82%** of seconds, with boundaries at F1 0.81. The explainer matched almost exactly (kappa 0.99); the vlog less so (0.48), because a narrated travel day blurs story with opinion and explanation.

The person reviewed Gemini's draft rather than labelling blind, which biases agreement upward. The report counts the beats changed so the bias is visible.

## How we got there

Five iterations. Every change to the prompt or the labels bumped the extraction version.

| Iteration | Version  | Boundary F1 | beat_type κ | framing/visual κ | energy wκ | assumed knowledge wκ | info density wκ | talking head share wκ | Gate |
| --------- | -------- | ----------- | ----------- | ---------------- | --------- | -------------------- | --------------- | --------------------- | ---- |
| 0         | beats-v1 | 0.80        | 0.58        | 0.42             | 0.72      | 0.90                 | 0.83            | n/a                   | fail |
| 1         | beats-v2 | 0.78        | 0.72        | 0.37             | 0.57      | 0.91                 | 0.85            | n/a                   | fail |
| 2         | beats-v3 | 0.79        | 0.76        | 0.58             | 0.58      | 0.89                 | 0.84            | n/a                   | fail |
| 3         | beats-v4 | 0.73        | 0.66        | 0.63             | 0.41      | 0.82                 | 0.71            | 0.76                  | fail |
| 4         | beats-v5 | 0.76        | 0.65        | 0.81             | 0.75      | 0.78                 | 0.78            | 0.70                  | pass |
| Needs     |          | ≥ 0.7       | ≥ 0.6       | ≥ 0.7            | ≥ 0.5     | ≥ 0.5                | ≥ 0.5           | ≥ 0.5                 |      |

| Iteration | Change                                                                                                                   | Effect                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | The Phase 05 prompt                                                                                                      | Beat types (0.58) and framing (0.42) failed. Gemini wavered between `demonstration` and `explanation`, and used `mixed` inconsistently |
| 1         | Sharper beat-type and framing definitions, with tie-break rules                                                          | Beat types passed (0.72); framing did not move (`mixed` again)                                                                         |
| 2         | Six framings: no `mixed`, one talking head, slides within graphics                                                       | Framing rose to 0.58; disagreement moved to beats that cut between a presenter and a screen                                            |
| 3         | Framing replaced by `talking_head_share` (1 to 5) and `visual`                                                           | The presenter's share passed (0.76) and visual reached 0.63. Energy dropped (0.41), and the run lost a video to timeouts               |
| 4         | Observable energy anchors (pace, volume, gestures, tempo) and sharper visual rules; the measurement re-runs failed calls | Every measure passed                                                                                                                   |

Collapsing and restructuring labels is the point of the gate: the model can only learn from distinctions Gemini makes reliably.

## Caveats

- **Beat types are the marginal measure.** Across the three run pairs of the final iteration they scored 0.58, 0.61 and 0.76. The average passes, and so does the one pair that compared all six videos.
- **One extraction is missing** from the final iteration (the vlog's run 1 failed twice on a network timeout). The pair of runs with all six videos passes every threshold on its own.
- **Six videos and three runs** give scores that move by about ±0.1 between identical measurements.
- **Two test videos are music**, where almost everything is `performance`. They make labels look steadier than talking content would on its own.
- **Human agreement comes from a review**, not blind labels; see above.

## Cost

| Item                                              | Cost                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Extraction                                        | **$0.0088 per minute of video** (Gemini 3.8 Flash, $0.75 input and $3.75 output per million tokens through Dec 31, 2026) |
| A 500-video channel of 10-minute videos           | about $44                                                                                                                |
| The whole gate (5 iterations and human agreement) | $6.19 for 993 minutes of video                                                                                           |

The numbers come from `quality_reports` (stages `extraction-consistency`, `extraction-human-agreement` and `extraction-quality-gate`). Reproduce them with `soundcheck consistency runs | human | gate --channel <id>`.
