import { buttonVariants } from "@soundcheck/ui/components/button";
import Link from "next/link";

export default function VideoNotFound() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-12 sm:px-6">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
        Video not found
      </h1>
      <p className="max-w-2xl text-lg text-ink-muted">
        This video isn&apos;t among your channel&apos;s analysed videos. It may be too new, too
        short, or not yet published by a build.
      </p>
      <div>
        <Link href="/app/videos" className={buttonVariants({ variant: "secondary" })}>
          See all videos
        </Link>
      </div>
    </main>
  );
}
