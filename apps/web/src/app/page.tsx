import Link from "next/link";
import { auth } from "@/auth";
import { ConnectButton } from "@/components/auth-buttons";

export default async function HomePage() {
  const session = await auth();
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col justify-center gap-6 px-6 py-24">
      <span className="w-fit rounded-full border-2 border-ink bg-highlight px-3 py-1 text-sm font-medium">
        In development
      </span>
      <h1 className="font-heading text-6xl font-bold tracking-tight md:text-8xl">Soundcheck</h1>
      <p className="max-w-xl text-lg text-ink-muted">
        Learns how each of your audiences watches, then predicts how a new cut will perform before
        you publish it.
      </p>
      <div>
        {session?.userId ? (
          <Link href="/app" className="font-medium underline underline-offset-4">
            Open your channel
          </Link>
        ) : (
          <ConnectButton />
        )}
      </div>
      <p className="max-w-xl text-sm text-ink-muted">
        Soundcheck asks for read-only access to your channel and its analytics. It never posts,
        edits or sees monetization data.
      </p>
    </main>
  );
}
