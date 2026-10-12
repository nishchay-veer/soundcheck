import { Skeleton } from "@soundcheck/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <Skeleton className="h-12 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((stat) => (
          <Skeleton key={stat} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-24" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
      <span className="sr-only">Loading your audiences</span>
    </main>
  );
}
