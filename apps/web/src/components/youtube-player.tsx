"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from "react";

/** The slice of the YouTube IFrame Player API this page uses. */
interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      playerVars: Record<string, number>;
      events: { onReady: () => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<YTNamespace> | null = null;

/** Loads the IFrame Player API once per page; rejects when the script cannot load. */
function loadApi(): Promise<YTNamespace> {
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      api = null;
      reject(new Error("The YouTube player could not load"));
    };
    document.head.append(script);
  });
  return api;
}

export interface PlayerHandle {
  /** Moves the video to a second; before the player is ready, it waits. */
  seekTo(seconds: number): void;
}

/** How often the playhead follows the player. */
const TICK_MS = 500;

/**
 * The video, embedded from youtube-nocookie.com (YouTube sets no tracking
 * cookies until it plays), with `seekTo` for the page. `onTime` follows the
 * playhead. Without the YouTube script (offline, blocked), it offers a link.
 * The wrapper's `data-current-time` reports the player's time, for tests.
 */
export function YouTubePlayer({
  videoId,
  title,
  onTime,
  ref,
}: {
  videoId: string;
  title: string;
  onTime?: (seconds: number) => void;
  ref?: Ref<PlayerHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const pending = useRef<number | null>(null);
  const report = useEffectEvent((seconds: number) => onTime?.(seconds));
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [time, setTime] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    loadApi()
      .then((YT) => {
        if (!live || !host.current) return;
        // YouTube replaces the element it is given with its iframe, so it gets
        // one React does not manage; React keeps the container.
        const mount = document.createElement("div");
        host.current.replaceChildren(mount);
        const created = new YT.Player(mount, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              if (!live) return;
              created.getIframe().title = `Video player: ${title}`;
              player.current = created;
              setState("ready");
              if (pending.current !== null) created.seekTo(pending.current, true);
              timer = setInterval(() => {
                const now = created.getCurrentTime();
                setTime(now);
                report(now);
              }, TICK_MS);
            },
          },
        });
      })
      .catch(() => live && setState("failed"));
    const container = host.current;
    return () => {
      live = false;
      clearInterval(timer);
      player.current?.destroy();
      player.current = null;
      container?.replaceChildren();
    };
  }, [videoId, title]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds: number) {
        pending.current = seconds;
        player.current?.seekTo(seconds, true);
      },
    }),
    [],
  );

  return (
    <div
      data-current-time={time === null ? undefined : time.toFixed(1)}
      className="flex flex-col gap-2"
    >
      <div className="aspect-video overflow-hidden rounded-[4px] border-2 border-ink bg-ink">
        <div ref={host} className="size-full [&>iframe]:size-full" />
      </div>
      {state === "failed" ? (
        <p className="text-sm">
          The player could not load.{" "}
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            Watch on YouTube
          </a>
        </p>
      ) : null}
    </div>
  );
}
