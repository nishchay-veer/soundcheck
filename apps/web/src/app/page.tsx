import { Badge } from "@soundcheck/ui/components/badge";
import { buttonVariants } from "@soundcheck/ui/components/button";
import Link from "next/link";
import { ConnectButton } from "@/components/auth-buttons";
import { currentUserId } from "@/lib/session";

/** What Soundcheck reads, in plain words; every item is true of the code. */
const READS = [
  "Your channel's videos and their public details: titles, lengths and thumbnails.",
  "YouTube Analytics for each video: views, watch time, how long subscribers and newcomers kept watching, and where viewers came from.",
  "The videos themselves: Gemini, Google's AI model, watches each public video to mark its beats, such as the hook, a sponsor read or the payoff.",
];

export default async function HomePage() {
  const userId = await currentUserId();
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col px-4 sm:px-6">
      <section className="flex flex-col gap-6 py-16 sm:py-24">
        <Badge>In development</Badge>
        <h1 className="max-w-4xl font-heading text-[48px] leading-[1.05] font-bold tracking-tight sm:text-[64px] lg:text-[80px]">
          Run a soundcheck before you publish
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          Soundcheck learns how your subscribers and newcomers actually watch, from your own videos,
          then predicts how a new cut will hold each of them, with an honest margin of error.
        </p>
        <div>
          {userId ? (
            <Link href="/app" className={buttonVariants()}>
              Open your channel
            </Link>
          ) : (
            <ConnectButton />
          )}
        </div>
      </section>
      <section className="grid gap-10 border-t-2 border-ink py-12 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-[28px] leading-tight font-bold tracking-tight">
            What Soundcheck reads
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {READS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-ink-muted">
            Access is read-only: Soundcheck never posts, edits or sees monetization data. Only you
            can see your channel&apos;s screens.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-[28px] leading-tight font-bold tracking-tight">
            How to delete it
          </h2>
          <p>
            Open <strong>Channel</strong> and choose <strong>Disconnect and delete data</strong>.
            Soundcheck revokes its access to your YouTube account and deletes your channel&apos;s
            screens, analytics tables and files.
          </p>
        </div>
      </section>
    </main>
  );
}
