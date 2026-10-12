"use client";

import { Button } from "@soundcheck/ui/components/button";

/** Any signed-in screen that failed to load: say so plainly and offer to try again. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-12 sm:px-6">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
        This screen didn&apos;t load
      </h1>
      <p className="max-w-2xl text-lg text-ink-muted">
        Something went wrong on our side. Your data is safe; trying again usually works.
        {error.digest ? (
          <>
            {" "}
            Reference: <span className="font-mono text-base">{error.digest}</span>
          </>
        ) : null}
      </p>
      <div>
        <Button onClick={() => retry()}>Try again</Button>
      </div>
    </main>
  );
}
