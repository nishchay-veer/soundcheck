import { buttonVariants } from "@soundcheck/ui/components/button";
import Link from "next/link";

export default function SoundcheckNotFound() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-12 sm:px-6">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
        Soundcheck not found
      </h1>
      <p className="max-w-2xl text-lg text-ink-muted">
        This soundcheck isn&apos;t one of your channel&apos;s. The link may be wrong, or it may
        belong to another channel you manage.
      </p>
      <div>
        <Link href="/app/soundcheck" className={buttonVariants({ variant: "secondary" })}>
          See all soundchecks
        </Link>
      </div>
    </main>
  );
}
