// @vitest-environment jsdom
import { soundcheckDocSchema, type SoundcheckDoc } from "@soundcheck/core/schemas";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_SOUNDCHECK } from "@/app/styleguide/samples";
import { uploadFile } from "@/lib/upload";
import { SoundcheckForm } from "./soundcheck-form";
import { SoundcheckList } from "./soundcheck-list";
import { SOUNDCHECK_POLL_MS, SoundcheckView } from "./soundcheck-view";

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
