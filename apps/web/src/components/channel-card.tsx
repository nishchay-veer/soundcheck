import type { ChannelView } from "@soundcheck/core/schemas";
import Image from "next/image";
import Link from "next/link";
import { DeleteChannelButton } from "./delete-channel-button";

const numbers = new Intl.NumberFormat("en");

const BUILD_LABEL: Record<ChannelView["build"]["state"], string> = {
  not_started: "Not started",
  queued: "Queued",
  running: "Learning how your audiences watch",
  ready: "Ready",
  insufficient_data: "Not enough videos yet",
  failed: "Failed",
};

export function ChannelCard({ channel }: { channel: ChannelView }) {
  return (
    <article className="flex flex-col gap-6 rounded-[4px] border-2 border-ink bg-surface p-6 sm:flex-row sm:items-center">
      {channel.thumbnailUrl ? (
        <Image
          src={channel.thumbnailUrl}
          alt=""
          width={96}
          height={96}
          className="size-24 rounded-full border-2 border-ink"
        />
      ) : null}
      <div className="flex flex-1 flex-col gap-3">
        <h2 className="font-heading text-[28px] leading-tight font-bold tracking-tight">
          {channel.title}
        </h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-base tabular-nums sm:grid-cols-4">
          <div>
            <dt className="text-sm text-ink-muted">Subscribers</dt>
            <dd>
              {channel.subscriberCount === null
                ? "Hidden"
                : numbers.format(channel.subscriberCount)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Videos</dt>
            <dd>{numbers.format(channel.videoCount)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Connected</dt>
            <dd>{channel.connectedAt.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Analysis</dt>
            <dd>{BUILD_LABEL[channel.build.state]}</dd>
          </div>
        </dl>
        {channel.status === "reauth_required" ? (
          <p className="w-fit rounded-full border-2 border-ink bg-highlight px-3 py-1 text-sm font-medium">
            Access expired.{" "}
            <Link href="/reauth" className="underline underline-offset-4">
              Reconnect
            </Link>
          </p>
        ) : null}
      </div>
      <DeleteChannelButton channelId={channel.id} title={channel.title} />
    </article>
  );
}
