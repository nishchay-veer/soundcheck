import { Skeleton } from "@soundcheck/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 sm:px-6">
      <Skeleton className="h-12 w-2/3 max-w-xl" />
      <Skeleton className="h-6 w-full max-w-2xl" />
      {[0, 1, 2, 3, 4].map((step) => (
        <Skeleton key={step} className="h-16 w-full" />
      ))}
      <span className="sr-only">Loading the build</span>
    </main>
  );
}
