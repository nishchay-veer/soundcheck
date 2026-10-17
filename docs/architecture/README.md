# Soundcheck architecture and design

How Soundcheck is built, how its main flows run, who uses it, and what its screens look like. It is written for engineers joining the project, reviewers (security, data protection, product), and anyone deciding a change that crosses the web app, the pipeline and the modeling service.

Everything here was taken from the existing docs ([overview](../plan/overview.md), phase plans and notes, [infra/README.md](../../infra/README.md)) and then checked against the code at commit `48d7346`. Where they disagreed, the diagrams follow the code and [13 · Findings](13-findings.md) records the difference. Anything that could not be confirmed is listed as an open question rather than drawn.

## Reading order

| #   | Page                                                                   | What it answers                                                     | Diagrams                                     |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| 01  | [System context](01-system-context.md)                                 | What is Soundcheck, who uses it, what does it call?                 | C4 level 1                                   |
| 02  | [Containers](02-containers.md)                                         | What runs where, and what talks to what over which protocol?        | C4 level 2: request plane, batch plane       |
| 03  | [Components](03-components.md)                                         | What is inside the web app, the pipeline and the modeling service?  | C4 level 3 ×3                                |
| 04  | [Deployment and trust boundaries](04-deployment.md)                    | Environments, locations, identities, IAM, release path              | Placement, trust boundaries, release         |
| 05  | [Flow: connect and disconnect](05-flow-connect.md)                     | Onboarding and auth; deleting everything                            | Sequence, flowchart, sequence                |
| 06  | [Flow: channel build and weekly refresh](06-flow-channel-build.md)     | The long background path                                            | Sequence, flowchart, state machine, sequence |
| 07  | [Flow: soundcheck a new cut](07-flow-soundcheck.md)                    | The core transaction                                                | Sequence, flowchart, state machine           |
| 08  | [Flow: read a screen and simulate edits](08-flow-read-and-simulate.md) | The paths a creator waits on                                        | Sequence, flowchart, sequence                |
| 09  | [Flow: failure, retry and recovery](09-flow-failure-retry.md)          | What retries where; expired access; every timeout                   | Flowchart, sequence                          |
| 10  | [Use cases](10-use-cases.md)                                           | Every actor and what they trigger, with entry points in the code    | Use-case diagrams ×3, table                  |
| 11  | [Wireframes](11-wireframes.md)                                         | Every major screen and its states                                   | 10 SVG sheets                                |
| 12  | [Screen-flow map](12-screen-flow.md)                                   | How the screens connect, tied to the use cases                      | Flowchart, table                             |
| 13  | [Findings](13-findings.md)                                             | (a) open questions, (b) doc-vs-code drift, (c) gaps worth attention | —                                            |

To get oriented quickly, read 01, then 02, then 07 (the core transaction), then 13.

## Interactive diagrams

Four diagrams also exist as interactive pages made with archify. They support zoom, guided views and step-through motion, and every box links to the code it cites at the pinned commit. Download a file and open it in a browser, since GitHub shows HTML as source. Each is about 830 KB, because the viewer is inlined.

| Page                                                                                   | Companion to                                                   | Source                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| [Batch plane](interactive/batch-plane/batch-plane.html)                                | [02 §2.2](02-containers.md#22-batch-plane)                     | [candidate.json](interactive/batch-plane/candidate.json)       |
| [Trust boundaries](interactive/trust-boundaries/trust-boundaries.html)                 | [04 §4.2](04-deployment.md#42-trust-boundaries-and-identities) | [candidate.json](interactive/trust-boundaries/candidate.json)  |
| [Soundcheck: upload and trigger](interactive/soundcheck-upload/soundcheck-upload.html) | [07 §7.1](07-flow-soundcheck.md#71-file-upload-sequence)       | [candidate.json](interactive/soundcheck-upload/candidate.json) |
| [Soundcheck: the job run](interactive/soundcheck-job/soundcheck-job.html)              | [07 §7.1](07-flow-soundcheck.md#71-file-upload-sequence)       | [candidate.json](interactive/soundcheck-job/candidate.json)    |

The Mermaid diagrams in the pages above are the source of truth. The interactive pages show the same facts with source links.

## Conventions

- **Diagrams are Mermaid**, so they render on GitHub and diff in review. Each one stays near 15 nodes or fewer; larger subjects are split and linked. C4 views use flowchart syntax, because Mermaid's experimental C4 renderer lays out poorly.
- **Shapes in the C4 views.** Bold grey boxes run code, cylinders hold data, dashed white boxes are outside Soundcheck, and rounded boxes are people.
- **Arrows point the way a call goes**, from the caller to the callee. Every arrow names its protocol or API. In sequence diagrams, `-->>` is a reply and `-)` is an asynchronous event.
- **Every diagram has three things above it:** what it shows, who it's for, and three takeaways.
- **IDs connect the pages.** UC-xx are use cases ([10](10-use-cases.md)), W-xx are wireframes ([11](11-wireframes.md)), Q, D and C are findings ([13](13-findings.md)).
- **Words.** Following [CLAUDE.md](../../CLAUDE.md) rule 12, prose says "audience", while code names keep "cohort" where the code uses it.

## Keeping this current

Update the page that owns a fact when its source changes:

| When this changes                                                   | Update                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| A route in `apps/web/src/app/api/` or a page in `apps/web/src/app/` | 03 §3.1, 08, 10 table, 11, 12                           |
| A workflow in `infra/workflows/`, or a job in `deploy-pipeline.sh`  | 02, 06, 09 §9.3                                         |
| An IAM grant in `infra/0*.sh`                                       | 04 §4.2 and its interactive page                        |
| `packages/core/src/schemas/firestore.ts` or a BigQuery table        | 02 "Where state lives"; 05 §5.3 if deletion is affected |
| A soundcheck status, step or failure code                           | 07                                                      |
| A screen's layout or states                                         | 11 (the SVG sheet) and 12                               |

Before committing, check that every Mermaid block renders, for example with `@mermaid-js/mermaid-cli` or GitHub's preview. To rebuild an interactive page after editing its `candidate.json`, run archify's `finalize` with `--repo-root .`. Each candidate pins `meta.repository.revision`, so bump it to the commit whose code the citations describe.
