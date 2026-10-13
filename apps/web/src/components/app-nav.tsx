"use client";

import { Badge } from "@soundcheck/ui/components/badge";
import { Button } from "@soundcheck/ui/components/button";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { chooseChannel } from "@/lib/actions";

/** The app's screens; later phases build the ones marked soon. */
const ITEMS = [
  { label: "Audiences", href: "/app/audiences" },
  { label: "Videos", href: "/app/videos" },
  { label: "Soundcheck", href: "/app/soundcheck" },
  { label: "Model", href: null },
] as const;

const item = "flex shrink-0 items-center gap-1.5 rounded-[4px] border-2 px-3 py-1.5 font-medium";

/**
 * The bar under the header: the screens (the current one in pink), a channel
 * switcher when the user has more than one channel, and channel settings.
 */
export function AppNav({
  channels,
  currentId,
}: {
  channels: readonly { id: string; title: string }[];
  currentId: string | null;
}) {
  const pathname = usePathname();
  const settings = pathname.startsWith("/app/settings");
  return (
    <nav aria-label="App" className="border-b-2 border-ink bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          {ITEMS.map(({ label, href }) =>
            href ? (
              <li key={label}>
                <Link
                  href={href}
                  aria-current={pathname.startsWith(href) ? "page" : undefined}
                  className={cn(
                    item,
                    FOCUS_RING,
                    pathname.startsWith(href)
                      ? "border-ink bg-accent"
                      : "border-transparent hover:border-ink",
                  )}
                >
                  {label}
                </Link>
              </li>
            ) : (
              <li key={label}>
                <span
                  aria-disabled="true"
                  className={cn(item, "border-transparent text-ink-muted")}
                >
                  {label}
                  <Badge variant="plain" className="px-1.5 py-0 text-xs">
                    Soon
                  </Badge>
                </span>
              </li>
            ),
          )}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {channels.length > 1 ? (
            <form action={chooseChannel} className="flex items-center gap-2">
              <label htmlFor="channel" className="sr-only">
                Channel
              </label>
              <select
                id="channel"
                name="channel"
                defaultValue={currentId ?? undefined}
                className={cn(
                  "max-w-48 rounded-[4px] border-2 border-ink bg-surface px-2 py-1.5",
                  FOCUS_RING,
                )}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.title}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" className="px-3 py-1.5">
                Switch
              </Button>
            </form>
          ) : null}
          <Link
            href="/app/settings"
            aria-current={settings ? "page" : undefined}
            className={cn(
              item,
              FOCUS_RING,
              settings ? "border-ink bg-accent" : "border-transparent hover:border-ink",
            )}
          >
            <Settings aria-hidden="true" className="size-4" />
            Channel
          </Link>
        </div>
      </div>
    </nav>
  );
}
