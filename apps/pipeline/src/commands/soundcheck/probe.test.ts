import { describe, expect, it, vi } from "vitest";
import { parseProbe, probeError, probeUpload, storageUrl } from "./probe";

const TOKEN = "ya29.secret-token";

describe("probing an upload", () => {
  it("reads the length and whether there is a picture", () => {
    expect(
      parseProbe(
        JSON.stringify({
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
          format: { duration: "612.48" },
        }),
      ),
    ).toEqual({ durationS: 612.48, hasVideo: true });
    expect(
      parseProbe(
        JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "90" } }),
      ),
    ).toEqual({ durationS: 90, hasVideo: false });
    expect(() => parseProbe(JSON.stringify({ format: {} }))).toThrow(/no duration/);
  });

  it("addresses the object over HTTPS, each segment encoded", () => {
    expect(storageUrl("gs://my-uploads/UCx/abc/source.mov")).toBe(
      "https://storage.googleapis.com/my-uploads/UCx/abc/source.mov",
    );
    expect(storageUrl("gs://b/a dir/x#y.mp4")).toBe(
      "https://storage.googleapis.com/b/a%20dir/x%23y.mp4",
    );
    expect(() => storageUrl("https://example.com/x.mp4")).toThrow(RangeError);
  });

  it("sends the token in a header, never in the URL", async () => {
    const run = vi.fn(async () =>
      JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "75" } }),
    );
    await expect(
      probeUpload("gs://u/UCx/abc/source.mp4", { run, token: async () => TOKEN }),
    ).resolves.toEqual({ durationS: 75, hasVideo: true });
    const [args] = run.mock.calls[0] as unknown as [string[]];
    expect(args).toContain(`Authorization: Bearer ${TOKEN}\r\n`);
    expect(args.at(-1)).toBe("https://storage.googleapis.com/u/UCx/abc/source.mp4");
    expect(args.at(-1)).not.toContain(TOKEN);
  });

  it("keeps the token out of its errors", () => {
    const failure = Object.assign(
      new Error(`Command failed: ffprobe -headers Authorization: Bearer ${TOKEN}`),
      {
        cmd: `ffprobe -headers Authorization: Bearer ${TOKEN}`,
        stderr:
          "https://storage.googleapis.com/u/x.mp4: Server returned 403 Forbidden (access denied)\n",
      },
    );
    const error = probeError(failure);
    expect(error.message).toBe(
      "ffprobe could not read the upload: https://storage.googleapis.com/u/x.mp4: Server returned 403 Forbidden (access denied)",
    );
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(error.cause).toBeUndefined();
    expect(probeError({ killed: true, cmd: TOKEN }).message).toBe(
      "ffprobe could not read the upload: timed out",
    );
  });
});
