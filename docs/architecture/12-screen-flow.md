# 12 · Screen-flow map

Part of the [architecture set](README.md). Previous: [11 · Wireframes](11-wireframes.md). Next: [13 · Findings](13-findings.md).

**What it shows.** Every screen as a node labelled with its wireframe (W-xx), and every way between them as an arrow labelled with the action and the use case (UC-xx) it serves. Automatic redirects are dotted.

**Who it's for.** UX and product people planning a change to navigation, and engineers adding a screen, who need to know which guards and redirects to copy.

**Three takeaways.**

1. **`/app` decides where you land.** A creator never picks between Building and Audiences. The `/app` router sends them by `status` and `build.state`, and every app page repeats those guards ([08](08-flow-read-and-simulate.md#82-which-screen-a-request-ends-on)).
2. **Soundchecks form a loop of their own.** List → new → result, with **New soundcheck** offered again after a failure. All of it is gated on a published summary.
3. **Two places are dead ends.** "No channel yet" after a disconnect has no connect button. The **Model** tab is shown but disabled ("Soon"), and no plan in `docs/plan` describes it yet ([13 · Findings](13-findings.md)).

```mermaid
flowchart LR
  W01["W-01 Landing<br/>/"]
  G["Google consent<br/>(external)"]
  W02["W-02 Connect result<br/>/connect/*"]
  APP{"/app router<br/>(appHome)"}
  RA["W-02 Reconnect<br/>/reauth"]
  NC["W-02 No channel yet<br/>/app"]
  W03["W-03 Building<br/>/app/building"]
  W04["W-04 Audiences<br/>/app/audiences"]
  W05["W-05 Videos<br/>/app/videos"]
  W06["W-06 Video autopsy<br/>/app/videos/[id]"]
  W07["W-07 Soundchecks<br/>/app/soundcheck"]
  W08["W-08 New soundcheck<br/>/app/soundcheck/new"]
  W09["W-09 Soundcheck result<br/>/app/soundcheck/[id]"]
  W10["W-10 Channel<br/>/app/settings"]

  W01 -->|"Connect (UC-02)"| G
  G -->|"connected (UC-02, UC-03)"| APP
  G -->|"scopes missing, no channel,<br/>channel taken, error"| W02
  W02 -->|"Try again (UC-02)"| G
  APP -.->|"status reauth_required"| RA
  RA -->|"Reconnect (UC-06)"| G
  APP -.->|"build not ready"| W03
  APP -.->|"build ready"| W04
  APP -.->|"no channel"| NC
  W03 -->|"See your audiences (UC-04)"| W04
  W04 -->|"app bar"| W05
  W05 -->|"row (UC-13)"| W06
  W06 -->|"cause chip: effect sheet (UC-11)"| W04
  W04 -->|"app bar"| W07
  W07 -->|"New soundcheck (UC-15)"| W08
  W08 -->|"Run soundcheck (UC-16, UC-17)"| W09
  W07 -->|"row (UC-18)"| W09
  W09 -->|"after a failure (UC-15)"| W08
  W04 -->|"app bar: Channel"| W10
  W10 -->|"Disconnect (UC-08)"| NC
  W10 -->|"Switch (UC-07)"| APP
```

The app bar links every signed-in screen to Audiences, Videos, Soundcheck and Channel. To keep the map readable, those edges are drawn only from W-04. W-04 and W-05 redirect back to W-03 while nothing is published, and W-08 redirects to W-07.

## Screens, use cases and data

| Wireframe                                                  | Route                            | Use cases           | Reads                                        | Writes or starts                                       |
| ---------------------------------------------------------- | -------------------------------- | ------------------- | -------------------------------------------- | ------------------------------------------------------ |
| [W-01](11-wireframes.md#w-01--landing-page)                | `/`                              | UC-01, UC-02        | Settings only                                | Google sign-in (server action)                         |
| [W-02](11-wireframes.md#w-02--connect-results-and-notices) | `/connect/*`, `/reauth`, `/app`  | UC-02, UC-03, UC-06 | —                                            | Google sign-in                                         |
| [W-03](11-wireframes.md#w-03--building)                    | `/app/building`                  | UC-04, UC-05        | `channels/{id}` (polled), `summary/current`  | `POST …/build`                                         |
| [W-04](11-wireframes.md#w-04--audiences)                   | `/app/audiences`                 | UC-10, UC-11        | `summary/current`                            | —                                                      |
| [W-05](11-wireframes.md#w-05--videos)                      | `/app/videos`                    | UC-12               | `index/videos`                               | —                                                      |
| [W-06](11-wireframes.md#w-06--video-autopsy)               | `/app/videos/[videoId]`          | UC-13, UC-14        | `videos/{videoId}`                           | — (YouTube embed in the browser)                       |
| [W-07](11-wireframes.md#w-07--soundchecks)                 | `/app/soundcheck`                | UC-21, UC-15        | `soundchecks` (newest 30), `summary/current` | —                                                      |
| [W-08](11-wireframes.md#w-08--new-soundcheck)              | `/app/soundcheck/new`            | UC-15, UC-16, UC-17 | `summary/current`                            | `POST …/soundchecks`; chunked PUTs to Cloud Storage    |
| [W-09](11-wireframes.md#w-09--soundcheck-result)           | `/app/soundcheck/[soundcheckId]` | UC-18, UC-19, UC-20 | `soundchecks/{sid}` (polled)                 | `POST …/simulate` (computes; writes nothing)           |
| [W-10](11-wireframes.md#w-10--channel-settings)            | `/app/settings`                  | UC-08, UC-07, UC-06 | `users/{sub}`, `channels/{id}`               | `DELETE /api/v1/channels/[id]`; `chooseChannel` cookie |

Use cases with no screen: UC-30 to UC-33 (workflows and jobs) and UC-40 to UC-45 (the operator's terminal and console). See [10 · Use cases](10-use-cases.md#103-scheduled-event-driven-and-operator-use-cases).
