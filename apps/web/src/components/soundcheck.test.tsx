// @vitest-environment jsdom
import { soundcheckDocSchema, type Simulation, type SoundcheckDoc } from "@soundcheck/core/schemas";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_SOUNDCHECK } from "@/app/styleguide/samples";
import { uploadFile } from "@/lib/upload";
import { SoundcheckForm } from "./soundcheck-form";
import { SoundcheckList } from "./soundcheck-list";
import { EDIT_DEBOUNCE_MS, SOUNDCHECK_POLL_MS, SoundcheckView } from "./soundcheck-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/upload", async (original) => ({
  ...(await original<typeof import("@/lib/upload")>()),
  uploadFile: vi.fn(async () => undefined),
}));
// The real player loads YouTube's script.
vi.mock("./youtube-player", () => ({ YouTubePlayer: () => <div data-testid="player" /> }));

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const ID = SAMPLE_SOUNDCHECK.soundcheckId;
const SESSION = "https://storage.googleapis.com/upload/storage/v1/b/u/o?upload_id=abc";

const doc = (overrides: Partial<SoundcheckDoc>): SoundcheckDoc =>
  soundcheckDocSchema.parse({ ...SAMPLE_SOUNDCHECK, ...overrides });
const running = (step: "watching" | "predicting", message: string) =>
  doc({
    status: "running",
    progress: { step, message, done: step === "watching" ? 1 : 2, total: 5 },
    prediction: null,
    narrative: null,
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  push.mockReset();
  vi.mocked(uploadFile).mockClear();
});

describe("the sample soundcheck", () => {
  it("is a valid document", () => {
    expect(soundcheckDocSchema.parse(SAMPLE_SOUNDCHECK)).toEqual(SAMPLE_SOUNDCHECK);
  });
});

describe("SoundcheckForm", () => {
  /** The API: answers the POST with `status` and `body`. */
  function api(status: number, body: unknown) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("checks a link before sending it, then starts the soundcheck and opens it", async () => {
    const user = userEvent.setup();
    const fetch = api(201, { soundcheckId: ID, status: "queued", upload: null });
    render(<SoundcheckForm channelId={CHANNEL} />);
    await user.click(screen.getByRole("radio", { name: "YouTube link" }));
    await user.click(screen.getByLabelText(/YouTube link/));
    await user.paste("https://vimeo.com/1");
    await user.click(screen.getByRole("button", { name: "Run soundcheck" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /isn't a link to a YouTube video/,
    );
    expect(fetch).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/YouTube link/));
    await user.click(screen.getByLabelText(/YouTube link/));
    await user.paste("https://youtu.be/lgxOjPdCGkw");
    await user.click(screen.getByLabelText(/Working title/));
    await user.paste("New cover");
    await user.selectOptions(screen.getByLabelText(/Expected traffic/), "Mostly suggested");
    await user.click(screen.getByRole("button", { name: "Run soundcheck" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/app/soundcheck/${ID}`));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/channels/${CHANNEL}/soundchecks`);
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "youtube",
      link: "https://youtu.be/lgxOjPdCGkw",
      title: "New cover",
      scenario: "suggested",
    });
  });

  it("refuses a file of another type before uploading anything", async () => {
    const fetch = api(201, {});
    render(<SoundcheckForm channelId={CHANNEL} />);
    const input = screen.getByLabelText(/Drop your cut here/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "cut.avi", { type: "video/x-msvideo" })] },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Soundcheck takes MP4, MOV or WebM videos.",
    );
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads a file to its session, then opens the soundcheck", async () => {
    const user = userEvent.setup();
    const fetch = api(201, {
      soundcheckId: ID,
      status: "awaiting_upload",
      upload: { sessionUrl: SESSION, chunkBytes: 8 * 1024 * 1024 },
    });
    render(<SoundcheckForm channelId={CHANNEL} />);
    const cut = new File(["0123456789"], "rough cut.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText(/Drop your cut here/), { target: { files: [cut] } });
    expect(screen.getByText("rough cut.mp4")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Run soundcheck" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/app/soundcheck/${ID}`));
    expect(
      JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    ).toEqual({
      kind: "file",
      fileName: "rough cut.mp4",
      contentType: "video/mp4",
      sizeBytes: 10,
      title: "",
      scenario: "recent",
    });
    expect(uploadFile).toHaveBeenCalledWith(
      cut,
      SESSION,
      expect.objectContaining({ chunkBytes: 8 * 1024 * 1024 }),
    );
  });

  it("explains what the API refused", async () => {
    const user = userEvent.setup();
    api(409, { error: "not_built" });
    render(<SoundcheckForm channelId={CHANNEL} />);
    await user.click(screen.getByRole("radio", { name: "YouTube link" }));
    await user.click(screen.getByLabelText(/YouTube link/));
    await user.paste("https://youtu.be/lgxOjPdCGkw");
    await user.click(screen.getByRole("button", { name: "Run soundcheck" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/first build hasn't finished/);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SoundcheckView", () => {
  const view = (initial: SoundcheckDoc) =>
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, refreshWhenHidden: true }}
      >
        <SoundcheckView channelId={CHANNEL} initial={initial} />
      </SWRConfig>,
    );

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("shows the job's progress, then the prediction once it is ready", async () => {
    const answers = [
      running("predicting", "Found 7 beats. Predicting how your audiences will watch"),
      SAMPLE_SOUNDCHECK,
    ];
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(answers.shift() ?? SAMPLE_SOUNDCHECK)),
    );
    vi.stubGlobal("fetch", fetch);
    view(running("watching", "Watching your video"));
    expect(screen.getByRole("heading", { name: "Watching your video" })).toBeTruthy();
    expect(screen.getByText(/You can leave this page/)).toBeTruthy();

    // SWR checks once on mount, then every 2 s until the soundcheck is done.
    expect(await screen.findByRole("heading", { name: /Found 7 beats/ })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(SOUNDCHECK_POLL_MS + 50));
    expect(await screen.findByText("Predicted average view")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/api/v1/channels/${CHANNEL}/soundchecks/${ID}`);
    // Ready: no more polling.
    const calls = fetch.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(SOUNDCHECK_POLL_MS * 3));
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it("shows the prediction with its ranges, the scenario and that it is not a result yet", () => {
    view(SAMPLE_SOUNDCHECK);
    expect(
      screen.getByRole("heading", { level: 1, name: "How I built a guitar in a weekend" }),
    ).toBeTruthy();
    expect(screen.getByText("Expected traffic: Mostly search")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Not a result yet");
    const stats = screen.getByRole("region", { name: "Prediction" });
    expect(stats.textContent).toContain("1:22");
    expect(stats.textContent).toContain("1:10 to 1:35");
    expect(stats.textContent).toContain("Better than 67%");
    expect(stats.textContent).toContain("of your 3 recent videos");
    expect(
      screen.getByText(/Newcomers/, { selector: "li span" }).closest("li")?.textContent,
    ).toContain("Of the cut 35% (29 to 42%)");
    expect(screen.getByText(/better than 67% of your 3 recent videos\.$/)).toBeTruthy();
    // Predicted curves only: nothing to hide.
    expect(screen.queryByRole("button", { name: "Show model" })).toBeNull();
    expect(
      screen.getByRole("img", { name: /predicted to be still watching at the end/ }),
    ).toBeTruthy();
    // An uploaded file has no player.
    expect(screen.queryByTestId("player")).toBeNull();
  });

  it("plays a linked video beside the chart", () => {
    view(doc({ input: { kind: "youtube", videoId: "lgxOjPdCGkw" } }));
    expect(screen.getByTestId("player")).toBeTruthy();
  });

  it("says what went wrong and offers a new soundcheck", () => {
    view(
      doc({
        status: "failed",
        prediction: null,
        error: {
          code: "private_video",
          message: "This video is private, so we can't watch it.",
        },
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "This video is private, so we can't watch it.",
    );
    expect(screen.getByRole("link", { name: "New soundcheck" }).getAttribute("href")).toBe(
      "/app/soundcheck/new",
    );
  });

  it("waits for an upload, and says what to do if the page was closed", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(SAMPLE_SOUNDCHECK))),
    );
    view(doc({ status: "awaiting_upload", progress: null, prediction: null }));
    expect(screen.getByRole("heading", { name: "Waiting for the upload" })).toBeTruthy();
  });
});

describe("SoundcheckView with edits", () => {
  const SIMULATE = `/api/v1/channels/${CHANNEL}/soundchecks/${ID}/simulate`;
  const prediction = SAMPLE_SOUNDCHECK.prediction as NonNullable<SoundcheckDoc["prediction"]>;
  const usableModel = { runId: "run1", usable: true, unusableReasons: [], trainedVideos: 24 };
  /** The sample, with usable models and the sponsor move recommended. */
  const USABLE = doc({
    prediction: {
      ...prediction,
      audiences: {
        subscribed: { ...prediction.audiences.subscribed!, model: usableModel },
        unsubscribed: { ...prediction.audiences.unsubscribed!, model: usableModel },
      },
    },
    edits: SAMPLE_SOUNDCHECK.edits.map((edit) => ({
      ...edit,
      recommended: edit.editId === "move-3-to-5",
    })),
  });
  /** The cut with the sponsor moved before the payoff. */
  const SIMULATION: Simulation = {
    durationS: 212,
    audiences: {
      subscribed: { ...prediction.audiences.subscribed!, avdS: { p10: 104, p50: 118, p90: 131 } },
      unsubscribed: { ...prediction.audiences.unsubscribed!, avdS: { p10: 68, p50: 81, p90: 95 } },
    },
    avdS: { p10: 76, p50: 88, p90: 101 },
    avp: { p10: 35.8, p50: 41.5, p90: 47.6 },
    delta: { avdS: { p10: 3.1, p50: 6.4, p90: 9.8 }, avpPp: { p10: 1.4, p50: 3, p90: 4.6 } },
    spans: [
      { beat: 0, startS: 0, endS: 8, fromS: 0, toS: 8, edit: null },
      { beat: 1, startS: 8, endS: 20, fromS: 8, toS: 20, edit: null },
      { beat: 2, startS: 20, endS: 70, fromS: 20, toS: 70, edit: null },
      { beat: 4, startS: 70, endS: 140, fromS: 100, toS: 170, edit: null },
      { beat: 3, startS: 140, endS: 170, fromS: 70, toS: 100, edit: "move" },
      { beat: 5, startS: 170, endS: 200, fromS: 170, toS: 200, edit: null },
      { beat: 6, startS: 200, endS: 212, fromS: 200, toS: 212, edit: null },
    ],
  };

  /** The API: the soundcheck on GET, `simulated` (status and body) on POST. */
  function api(initial: SoundcheckDoc, simulated: [number, unknown] = [200, SIMULATION]) {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify(simulated[1]), { status: simulated[0] })
        : new Response(JSON.stringify(initial)),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const posts = (fetch: ReturnType<typeof api>) =>
    fetch.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url, init]) => [url, JSON.parse(String(init?.body))] as const);
  const view = (initial: SoundcheckDoc) =>
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, refreshWhenHidden: true }}
      >
        <SoundcheckView channelId={CHANNEL} initial={initial} />
      </SWRConfig>,
    );
  const live = () =>
    screen.getByText(/^(Tick edits to see|Simulating|With \d|These edits|This soundcheck)/);
  const box = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("starts with the recommended edits ticked, and shows the cut with them", async () => {
    const fetch = api(USABLE);
    view(USABLE);
    expect(box(/Move the sponsor read/).checked).toBe(true);
    expect(box(/Move the payoff/).checked).toBe(false);
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
    // Simulated as soon as the page opens.
    await vi.waitFor(() =>
      expect(live().textContent).toBe("With 1 edit: +6.4 s (3.1 s to 9.8 s)(sure)"),
    );
    expect(posts(fetch)).toEqual([[SIMULATE, { edits: [{ op: "move", beat: 3, to: 5 }] }]]);

    const stats = screen.getByRole("region", { name: "Prediction" });
    expect(stats.textContent).toContain("Predicted average view with 1 edit1:28");
    expect(stats.textContent).toContain("1:16 to 1:41As it is: 1:22 (1:10 to 1:35)");
    expect(stats.textContent).toContain("Of the cut with 1 edit42%36 to 48% of 3:32As it is: 39%");
    expect(screen.getByRole("heading", { name: "Each audience with 1 edit" })).toBeTruthy();
    expect(
      screen.getByText(/Newcomers/, { selector: "li span" }).closest("li")?.textContent,
    ).toContain("Average view 1:21 (1:08 to 1:35)");
    // The narrative describes the cut as it is, so it gives way.
    expect(screen.queryByText(/Subscribers should watch about 53%/)).toBeNull();
    expect(screen.getByText(/Your cut as it is: hatched parts are cut/)).toBeTruthy();
    // The chapters follow the moved sponsor.
    expect(screen.getByText(/^start,end/).textContent).toContain("Move,Move the sponsor read");
  });

  it("asks once after quick ticks, and switches objective without asking again", async () => {
    const fetch = api(USABLE);
    view(USABLE);
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS + 10));
    await vi.waitFor(() => expect(posts(fetch)).toHaveLength(1));

    fireEvent.click(box(/Move the payoff/));
    fireEvent.click(box(/Trim the explanation/));
    expect(live().textContent).toBe("Simulating…");
    expect(posts(fetch)).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS + 10));
    await vi.waitFor(() => expect(posts(fetch)).toHaveLength(2));
    expect(posts(fetch)[1]?.[1]).toEqual({
      edits: [
        { op: "move", beat: 3, to: 5 },
        { op: "move", beat: 5, to: 2 },
        { op: "trim", beat: 2, keep: 0.5 },
      ],
    });
    await vi.waitFor(() => expect(live().textContent).toMatch(/^With 3 edits: \+6\.4 s/));

    fireEvent.click(screen.getByRole("radio", { name: "% of the cut" }));
    expect(live().textContent).toBe("With 3 edits: +3.0 pp (1.4 to 4.6)(sure)");
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 2));
    expect(posts(fetch)).toHaveLength(2);
  });

  it("goes back to the cut as it is once nothing is ticked", async () => {
    const fetch = api(USABLE);
    view(USABLE);
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS + 10));
    await vi.waitFor(() => expect(live().textContent).toMatch(/^With 1 edit/));
    fireEvent.click(box(/Move the sponsor read/));
    expect(live().textContent).toBe("Tick edits to see the cut with them.");
    expect(screen.getByText("Predicted average view")).toBeTruthy();
    expect(screen.getByText(/Subscribers should watch about 53%/)).toBeTruthy();
    expect(screen.queryByText(/Your cut as it is: hatched/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 2));
    expect(posts(fetch)).toHaveLength(1);
  });

  it("says why edits could not be simulated", async () => {
    api(USABLE, [409, { error: "not_ready" }]);
    view(USABLE);
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS + 10));
    await vi.waitFor(() =>
      expect(live().textContent).toBe(
        "This soundcheck isn't ready for edits yet. Reload the page in a minute.",
      ),
    );
    expect(screen.getByText("Predicted average view with 1 edit")).toBeTruthy();
    expect(
      screen.getByText("Predicted average view with 1 edit").parentElement?.textContent,
    ).toContain("1:22");
  });

  it("recommends on newcomers alone when only their model is usable", async () => {
    const partly = doc({
      prediction: {
        ...prediction,
        audiences: {
          subscribed: prediction.audiences.subscribed!,
          unsubscribed: { ...prediction.audiences.unsubscribed!, model: usableModel },
        },
      },
      edits: USABLE.edits,
      editsJudgedOn: ["unsubscribed"],
    });
    const fetch = api(partly);
    view(partly);
    expect(box(/Move the sponsor read/).checked).toBe(true);
    expect(screen.getByText("Recommended for newcomers")).toBeTruthy();
    expect(screen.getByText(/^Judged on newcomers:/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Not a result yet for subscribers");
    await vi.waitFor(() =>
      expect(live().textContent).toBe("With 1 edit, for newcomers: +6.4 s (3.1 s to 9.8 s)(sure)"),
    );
    expect(posts(fetch)).toEqual([[SIMULATE, { edits: [{ op: "move", beat: 3, to: 5 }] }]]);
  });

  it("ticks nothing while the model is not usable, but lets each edit be tried", async () => {
    const fetch = api(SAMPLE_SOUNDCHECK);
    view(SAMPLE_SOUNDCHECK);
    expect(screen.getAllByRole("checkbox").some((one) => (one as HTMLInputElement).checked)).toBe(
      false,
    );
    expect(screen.queryByText("Recommended")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 2));
    expect(posts(fetch)).toEqual([]);
    fireEvent.click(box(/Cut the call to action/));
    await act(() => vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS + 10));
    await vi.waitFor(() =>
      expect(posts(fetch)).toEqual([[SIMULATE, { edits: [{ op: "remove", beat: 6 }] }]]),
    );
  });
});

describe("SoundcheckList", () => {
  it("lists each soundcheck with its prediction or its status", () => {
    render(
      <SoundcheckList
        soundchecks={[
          SAMPLE_SOUNDCHECK,
          doc({
            soundcheckId: "f".repeat(32),
            title: "",
            status: "failed",
            prediction: null,
            error: { code: "too_long", message: "Too long." },
          }),
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/app/soundcheck/${ID}`,
      `/app/soundcheck/${"f".repeat(32)}`,
    ]);
    expect(links[0]?.textContent).toContain("Predicted average view 1:22");
    // Without a title, the file's name.
    expect(links[1]?.textContent).toContain("guitar rough cut v3.mov");
    expect(links[1]?.textContent).toContain("Failed");
  });
});
