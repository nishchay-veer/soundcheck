"use client";

import type { VideoDoc } from "@soundcheck/core/schemas";
import { useMemo, useRef, useState } from "react";
import { chartData, dropId, firstDrop } from "@/lib/drops";
import { AutopsyChart } from "./autopsy-chart";
import { DropPanel } from "./drop-panel";
import { YouTubePlayer, type PlayerHandle } from "./youtube-player";

/**
 * The autopsy: the chart and beat strip beside the player (below it on a
 * phone), then the selected drop-off's panel. Clicking the chart or strip
 * seeks the player; selecting a drop-off (by click or arrow key) seeks to
 * its start; the playhead follows the player.
 */
export function VideoAutopsy({ video }: { video: VideoDoc }) {
  const player = useRef<PlayerHandle>(null);
  const { series, drops } = useMemo(() => chartData(video), [video]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const first = firstDrop(video.drops);
    return first ? dropId(first) : null;
  });
  const [playhead, setPlayhead] = useState<number | null>(null);
  const selected = video.drops.find((drop) => dropId(drop) === selectedId) ?? null;

  function seek(seconds: number) {
    setPlayhead(seconds);
    player.current?.seekTo(seconds);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <AutopsyChart
          id={`video-${video.videoId}`}
          title="Who is still watching"
          durationS={video.durationS}
          series={series}
          beats={video.beats}
          drops={drops}
          selectedDropId={selectedId}
          onSelectDrop={(id) => {
            setSelectedId(id);
            const drop = drops.find((d) => d.id === id);
            if (drop) seek(drop.startS);
          }}
          onSeek={seek}
          playheadS={playhead}
        />
        <YouTubePlayer
          ref={player}
          videoId={video.videoId}
          title={video.title}
          onTime={setPlayhead}
        />
      </div>
      <DropPanel
        drop={selected}
        model={selected ? (video.audiences[selected.audience]?.model ?? null) : null}
      />
    </div>
  );
}
