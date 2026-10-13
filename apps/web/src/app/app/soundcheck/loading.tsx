import { Skeleton } from "@soundcheck/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 sm:px-6">
      <Skeleton className="h-12 w-1/2 max-w-md" />
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-16" />
      ))}
      <span className="sr-only">Loading your soundchecks</span>
    </main>
  );
}
