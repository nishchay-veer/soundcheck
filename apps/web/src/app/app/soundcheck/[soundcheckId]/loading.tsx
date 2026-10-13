import { Skeleton } from "@soundcheck/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 sm:px-6">
      <Skeleton className="h-12 w-2/3 max-w-2xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((stat) => (
          <Skeleton key={stat} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-96" />
      <span className="sr-only">Loading the soundcheck</span>
    </main>
  );
}
