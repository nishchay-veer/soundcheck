"use client";

import {
  SCENARIO_LABELS,
  SOUNDCHECK_LIMITS,
  parseYouTubeLink,
  scenarioSchema,
  soundcheckCreatedSchema,
  uploadTypeSchema,
  type Scenario,
} from "@soundcheck/core/schemas";
import { Button } from "@soundcheck/ui/components/button";
import { Progress } from "@soundcheck/ui/components/progress";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { uploadFile, UploadError } from "@/lib/upload";

type Mode = "file" | "youtube";

const chip = "rounded-full border-2 border-ink px-3 py-1 text-sm font-medium";
const field = cn(
  "rounded-[4px] border-2 border-ink bg-surface px-3 py-2 text-base text-ink",
  FOCUS_RING,
);
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 2).toLocaleString("en")} MB`;

/** What the API's refusals mean for the creator. */
const API_ERRORS: Record<string, string> = {
  not_built: "Your channel's first build hasn't finished, so there's no model to predict with yet.",
  soundchecks_not_configured: "Soundchecks aren't switched on for this app yet.",
  fixtures_mode: "Fixture data is read-only, so it can't run a soundcheck.",
  not_found: "We couldn't find this channel.",
};

/** The file's problem before anything is sent, or null when it can be uploaded. */
export function fileProblem(file: File): string | null {
  if (!uploadTypeSchema.safeParse(file.type).success) {
    return "Soundcheck takes MP4, MOV or WebM videos.";
  }
  if (file.size > SOUNDCHECK_LIMITS.maxUploadBytes) {
    return "This file is over 2 GB. Export a smaller file and try again.";
  }
  return null;
}

/**
 * A new soundcheck: an uploaded file or a YouTube link, a working title and
 * the traffic the creator expects. A file is uploaded from here in chunks,
 * with its progress; then the page moves to the soundcheck, which polls.
 */
export function SoundcheckForm({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [scenario, setScenario] = useState<Scenario>("recent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancel = useRef<AbortController | null>(null);

  function choose(chosen: File | undefined) {
    if (!chosen) return;
    setFile(chosen);
    setError(fileProblem(chosen));
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (mode === "file") {
      if (!file) return setError("Choose a video file first.");
      const problem = fileProblem(file);
      if (problem) return setError(problem);
    } else if (!parseYouTubeLink(link)) {
      return setError("That isn't a link to a YouTube video. Paste the video's link from YouTube.");
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/channels/${channelId}/soundchecks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "file" && file
            ? {
                kind: "file",
                fileName: file.name,
                contentType: file.type,
                sizeBytes: file.size,
                title,
                scenario,
              }
            : { kind: "youtube", link, title, scenario },
        ),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (response.status !== 201) {
        setError(
          body.message ??
            API_ERRORS[body.error ?? ""] ??
            "The soundcheck didn't start. Please try again in a minute.",
        );
        return;
      }
      const created = soundcheckCreatedSchema.parse(body);
      if (created.upload && file) {
        cancel.current = new AbortController();
        setSent(0);
        await uploadFile(file, created.upload.sessionUrl, {
          chunkBytes: created.upload.chunkBytes,
          onProgress: setSent,
          signal: cancel.current.signal,
        });
      }
      router.push(`/app/soundcheck/${created.soundcheckId}`);
    } catch (caught) {
      if (cancel.current?.signal.aborted) {
        setError("Upload cancelled.");
      } else {
        setError(
          caught instanceof UploadError
            ? caught.message
            : "The soundcheck didn't start. Please try again in a minute.",
        );
      }
      setSent(null);
    } finally {
      setBusy(false);
      cancel.current = null;
    }
  }

  const uploading = sent !== null && file !== null;
  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6" noValidate>
      <div role="radiogroup" aria-label="What to check" className="flex flex-wrap gap-2">
        {(
          [
            ["file", "Upload a file"],
            ["youtube", "YouTube link"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={busy}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={cn(chip, FOCUS_RING, mode === value ? "bg-accent" : "bg-surface")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-[4px] border-2 border-dashed border-ink px-6 py-10 text-center",
            dragging ? "bg-highlight" : "bg-surface",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
          )}
        >
          <span className="font-heading text-xl font-bold">
            {file ? file.name : "Drop your cut here, or choose a file"}
          </span>
          <span className="text-sm text-ink-muted">
            {file ? megabytes(file.size) : "MP4, MOV or WebM, up to 2 GB and 1 to 60 minutes long"}
          </span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="sr-only"
            disabled={busy}
            onChange={(event) => choose(event.target.files?.[0])}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          YouTube link
          <input
            type="url"
            inputMode="url"
            value={link}
            disabled={busy}
            placeholder="https://youtu.be/…"
            onChange={(event) => setLink(event.target.value)}
            className={field}
          />
          <span>
            Public or unlisted. A private video can&apos;t be watched: set it to Unlisted.
          </span>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Working title (optional)
        <input
          type="text"
          value={title}
          maxLength={SOUNDCHECK_LIMITS.maxTitleChars}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Expected traffic
        <select
          value={scenario}
          disabled={busy}
          onChange={(event) => setScenario(scenarioSchema.parse(event.target.value))}
          className={field}
        >
          {scenarioSchema.options.map((value) => (
            <option key={value} value={value}>
              {SCENARIO_LABELS[value]}
            </option>
          ))}
        </select>
        <span>It matters most for newcomers: where they come from changes how they watch.</span>
      </label>

      {uploading ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <Progress
            value={(100 * sent) / file.size}
            aria-label="Upload progress"
            aria-valuetext={`${megabytes(sent)} of ${megabytes(file.size)}`}
          />
          <p className="text-sm text-ink-muted">
            Uploading {megabytes(sent)} of {megabytes(file.size)}. Keep this page open until the
            upload finishes.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[4px] border-2 border-ink bg-surface p-3 font-medium">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy}>
          {uploading ? "Uploading…" : busy ? "Starting…" : "Run soundcheck"}
        </Button>
        {uploading ? (
          <Button type="button" variant="secondary" onClick={() => cancel.current?.abort()}>
            Cancel upload
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">
        Uploads are used only for this soundcheck and are deleted after 30 days.
      </p>
    </form>
  );
}
