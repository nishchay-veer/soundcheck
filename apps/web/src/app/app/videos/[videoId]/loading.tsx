import { Skeleton } from "@soundcheck/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 sm:px-6">
      <Skeleton className="h-12 w-2/3 max-w-2xl" />
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((stat) => (
          <Skeleton key={stat} className="h-24" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="aspect-video" />
      </div>
      <span className="sr-only">Loading the video</span>
    </main>
  );
}
