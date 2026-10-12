import { Skeleton } from "@soundcheck/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 sm:px-6">
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-11 w-full max-w-sm" />
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-24 w-full" />
      ))}
      <span className="sr-only">Loading your videos</span>
    </main>
  );
}
