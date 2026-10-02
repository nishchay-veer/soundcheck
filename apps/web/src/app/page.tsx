export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col justify-center gap-6 px-6 py-16">
      <span className="w-fit rounded-full border-2 border-ink bg-highlight px-3 py-1 text-sm font-medium">
        In development
      </span>
      <h1 className="font-heading text-6xl font-bold tracking-tight md:text-8xl">Soundcheck</h1>
      <p className="max-w-xl text-lg text-ink-muted">
        Learns how each of your audiences watches, then predicts how a new cut will perform before
        you publish it.
      </p>
    </main>
  );
}
