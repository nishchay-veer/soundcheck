# Soundcheck model card

Model `hazard-v2` on features `feat-bf1e3064fa6f` · generated 2026-10-10 by `soundcheck-modeling model-card` from the latest evaluation of each channel.

> **No result yet.** No channel has enough videos to hold some out: a real test needs 6 test videos and 30 training videos. Every number below comes from check mode, where each video is held out in turn to make sure the whole pipeline runs. They say nothing about how good the model is.

## What it predicts

For each audience of a channel (all viewers, subscribers, and newcomers who are not subscribed), the share of viewers still watching at each 1% of a video, with an 80% uncertainty band. It also turns the model into traits, such as "a 30 s sponsor read at 30% is associated with 2 points fewer viewers at the end", by editing a video's beats and predicting again. Everything is an association in the channel's past videos, not a cause.

## Data

| Channel | Evaluation | Videos tested | Training videos per fit | Data through |
| --- | --- | --- | --- | --- |
| `UC-BHlgFbFh3V76yth-XCmlw` | check: each video held out in turn | 3 | 2 | 2026-10-03 |

- `UC-BHlgFbFh3V76yth-XCmlw` runs in check mode: 3 settled videos: a held-out test needs 6 test videos and 30 training videos.

Each video is cut into 100 equal slices. Every slice has 86 features built by TypeScript from Gemini's beat extraction (`beats-v5`, which passed a consistency gate): beat types, picture, audio, delivery, pacing, narrative, position in the video, and for newcomers the traffic mix. The label is the measured share of viewers who leave during the slice.

## Method

- **Model:** a discrete-time hazard model, one per channel and audience: a fractional logistic regression of each slice's drop-off on 28 columns (49 for newcomers: plus traffic mix and its interactions). Columns that never vary in a channel's videos are dropped.
- **Weights:** within a video by the viewers still watching; each video counts log(1 + views) in total, so one viral video cannot dominate.
- **Shrinkage:** a ridge penalty whose strength is chosen by cross-validation that holds out whole videos; a pooled model across channels is the prior once at least 2 channels exist.
- **Uncertainty:** the Laplace covariance, scaled by the quasi-likelihood dispersion (how much the drop-offs scatter around the fit); bands come from 200 coefficient draws.
- **Evaluation:** the newest 20% of each channel's videos (at least 6, none under 14 days old) are held out; the model is refitted on the rest, and the pooled prior is refitted without the test videos.

## Results

Curve error is the mean absolute difference between the predicted and the measured share still watching, over slices 2 to 100, in percentage points; lower is better.

- **B0** is the channel's average curve, or the average of its 10 training videos nearest in length, whichever did better on the test videos (choosing it that way favours the baseline).
- **B1** is Gemini guessing the curve from the video alone, with no channel data.
- **B2** is the model without content features: only position and length.

### `UC-BHlgFbFh3V76yth-XCmlw` (check mode: not a result)

| Audience | Test videos | Model | B0 | B1 | B2 | Model minus B0, 95% interval | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All viewers | 3 | 15.4 | 18.5 (channel average) | 18.9 | 12.8 | -3.1 (-10.2 to +7.1) | no claim (check mode) |
| Subscribers | 3 | 30.1 | 19.8 (channel average) | 17.9 | 26.2 | +10.3 (-3.5 to +33.5) | no claim (check mode) |
| Newcomers | 3 | 27.9 | 19.3 (channel average) | 18.2 | 10.7 | +8.7 (-2.1 to +22.1) | no claim (check mode) |

| Audience | Measure | Model | B0 | B1 | B2 |
| --- | --- | --- | --- | --- | --- |
| All viewers | Share watched, error (pp) | 13.2 | 18.3 | 18.6 | 12.3 |
| All viewers | Drop-offs found (top 3 within 3 slices) | 56% | 67% | 56% | 56% |
| All viewers | Ranking of test videos (Spearman) | 0.50 | -1.00 | 1.00 | -0.50 |
| Subscribers | Share watched, error (pp) | 29.7 | 19.2 | 17.6 | 24.6 |
| Subscribers | Drop-offs found (top 3 within 3 slices) | 44% | 33% | 56% | 44% |
| Subscribers | Ranking of test videos (Spearman) | -1.00 | -1.00 | 0.50 | -1.00 |
| Newcomers | Share watched, error (pp) | 27.6 | 18.7 | 17.6 | 7.3 |
| Newcomers | Drop-offs found (top 3 within 3 slices) | 56% | 67% | 56% | 56% |
| Newcomers | Ranking of test videos (Spearman) | -1.00 | -1.00 | 1.00 | 0.50 |

## Calibration

The 80% band should contain about 80% of the measured points (70% to 90% is acceptable). If the validation videos, held out from the training set, miss that range, one factor scales the covariance and the test bands are drawn again with it.

| Channel | Audience | Measured points inside the 80% band | Inflation |
| --- | --- | --- | --- |
| `UC-BHlgFbFh3V76yth-XCmlw` | All viewers | 61% | not checked (check mode) |
| `UC-BHlgFbFh3V76yth-XCmlw` | Subscribers | 10% | not checked (check mode) |
| `UC-BHlgFbFh3V76yth-XCmlw` | Newcomers | 40% | not checked (check mode) |

## Limitations

- **Correlational.** The model learns which content goes with viewers leaving in a channel's past videos. It does not show that changing the content would change the viewers; the product says "associated with", never "causes".
- **Small samples.** A channel's model learns from its own videos only. Below 30 training videos a model is marked not usable and never shown. Slices of one video are not independent, so the uncertainty bands need the calibration check above.
- **Estimated audiences.** Search, suggested and browse newcomers are estimated from the newcomer model with the traffic mix set to one source. One is shown only when its share varies by at least 0.08 across at least 30 videos and at least one trait's interval excludes zero.
- **The Aug 27, 2026 view-counting change.** From that day YouTube counts a view from the first frame, autoplay and hover included. Views and curves on either side of the date are measured differently; weights use views, and `engaged_views` keeps the earlier meaning.
- **Baselines.** B1 is one prompt (`llm-retention-v1`) on one model; a better prompt could do better. B0 is chosen with the test videos in view, which favours it.
- **YouTube's average view percentage** counts rewatches and can pass 100%, so the share-watched error compares against the measured curve instead.
