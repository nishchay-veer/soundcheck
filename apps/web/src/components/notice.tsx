import type { ReactNode } from "react";

/** A full-page explanation with an optional action, for the connect and reauth pages. */
export function Notice({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-16">
      <h1 className="max-w-2xl font-heading text-[40px] leading-tight font-bold tracking-tight">
        {title}
      </h1>
      <div className="flex max-w-2xl flex-col gap-4 text-lg text-ink-muted">{children}</div>
      {action ? <div>{action}</div> : null}
    </main>
  );
}
