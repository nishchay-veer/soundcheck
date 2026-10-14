import { Badge } from "@soundcheck/ui/components/badge";
import { Button } from "@soundcheck/ui/components/button";
import { Card } from "@soundcheck/ui/components/card";
import { Progress } from "@soundcheck/ui/components/progress";
import { Skeleton } from "@soundcheck/ui/components/skeleton";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AudienceCard } from "@/components/audience-card";
import { EffectBar } from "@/components/effect-bar";
import { InfoTip } from "@/components/info-tip";
import { IntervalText } from "@/components/interval-text";
import { KindBadge } from "@/components/kind-badge";
import { ResultNotice } from "@/components/result-notice";
import { SoundcheckResult } from "@/components/soundcheck-view";
import { StatCard } from "@/components/stat-card";
import { BEAT_GROUPS } from "@/lib/beats";
import { ChartDemo } from "./chart-demo";
import { EditDemo } from "./edit-demo";
import { SAMPLE_CARDS, SAMPLE_EFFECTS, SAMPLE_SOUNDCHECK } from "./samples";
import { SheetDemo } from "./sheet-demo";

export const metadata: Metadata = {
  title: "Style guide · Soundcheck",
  robots: { index: false },
};

const TOKENS = [
  ["bg-bg", "--bg", "Page"],
  ["bg-surface", "--surface", "Cards, plots"],
  ["bg-ink", "--ink", "Text, borders"],
  ["bg-ink-muted", "--ink-muted", "Secondary text"],
  ["bg-rule", "--rule", "Gridlines"],
  ["bg-accent", "--accent", "Actions, selection"],
  ["bg-highlight", "--highlight", "Badges, banners"],
  ["bg-positive", "--positive", "Positive deltas"],
  ["bg-negative", "--negative", "Negative deltas, drop-offs"],
] as const;

const AUDIENCES = [
  ["bg-aud-subscribers", "Subscribers"],
  ["bg-aud-newcomers", "Newcomers"],
  ["bg-aud-search", "Newcomers from search (estimated)"],
  ["bg-aud-suggested", "Newcomers from suggested (estimated)"],
  ["bg-aud-browse", "Newcomers from browse (estimated)"],
] as const;

const BEATS = [
  [BEAT_GROUPS.opening.fill, "--beat-opening", "Opening: cold open, hook, branded intro"],
  [
    BEAT_GROUPS.promotion.fill,
    "--beat-promotion",
    "Promotion: sponsor, self-promo, call to action",
  ],
  [BEAT_GROUPS.closing.fill, "--beat-closing", "Closing: recap, outro, end screen"],
  [BEAT_GROUPS.tangent.fill, "dashed outline", "Tangent"],
  [BEAT_GROUPS.content.fill, "--surface", "Content: everything else"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6 border-t-2 border-ink py-10">
      <h2 className="font-heading text-[28px] leading-tight font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ fill, name, use }: { fill: string; name: string; use: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`size-12 shrink-0 rounded-[4px] border-2 border-ink ${fill}`}
      />
      <span className="flex flex-col">
        <span className="font-mono text-sm">{name}</span>
        <span className="text-sm text-ink-muted">{use}</span>
      </span>
    </li>
  );
}

/** Every component in every state, so the look is reviewed once (docs/plan/design-system.md). */
export default function StyleguidePage() {
  const domain = Math.max(...SAMPLE_EFFECTS.flatMap((e) => (e.ci ? e.ci.map(Math.abs) : [])));
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col px-4 py-12 sm:px-6">
      <h1 className="pb-4 font-heading text-[40px] leading-tight font-bold tracking-tight">
        Style guide
      </h1>
      <p className="max-w-2xl pb-10 text-lg text-ink-muted">
        Every component in every state, with made-up data. Each audience keeps its color on every
        screen.
      </p>

      <Section title="Colors">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOKENS.map(([fill, name, use]) => (
            <Swatch key={name} fill={fill} name={name} use={use} />
          ))}
        </ul>
        <h3 className="font-heading text-xl font-bold">Audiences</h3>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map(([fill, use]) => (
            <Swatch key={fill} fill={fill} name={fill.replace("bg-", "--")} use={use} />
          ))}
        </ul>
        <h3 className="font-heading text-xl font-bold">Beats</h3>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BEATS.map(([fill, name, use]) => (
            <Swatch key={name} fill={fill} name={name} use={use} />
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <p className="font-heading text-[64px] leading-none font-bold tracking-tight sm:text-[80px]">
          Hero 80
        </p>
        <p className="font-heading text-[40px] leading-tight font-bold tracking-tight">
          Page title 40
        </p>
        <p className="font-heading text-[28px] leading-tight font-bold tracking-tight">
          Section 28
        </p>
        <p className="max-w-2xl">
          Body text is Inter at 16px with a line height of 1.5. Numbers line up:{" "}
          <span className="tabular-nums">1,204 · 38.4% · 0:42</span>.
        </p>
        <p className="font-mono text-sm">
          JetBrains Mono for timestamps and IDs: 1:12 · lgxOjPdCGkw
        </p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <Button>Connect YouTube</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
        </div>
        <p className="text-sm text-ink-muted">
          Hover lifts a button and shows its shadow; Tab shows the focus ring.
        </p>
      </Section>

      <Section title="Badges and tooltips">
        <div className="flex flex-wrap items-center gap-4">
          <Badge>New</Badge>
          <Badge variant="plain">Plain</Badge>
          <KindBadge kind="measured" />
          <KindBadge kind="estimated" />
          <span className="flex items-center gap-1.5">
            Model error
            <InfoTip label="About model error">
              How far the predicted curve is from the real one, on average.
            </InfoTip>
          </span>
        </div>
      </Section>

      <Section title="Cards, progress and loading">
        <div className="grid gap-6 sm:grid-cols-2">
          <Card className="p-6">A static card has no shadow.</Card>
          <Card interactive className="p-6">
            A clickable card lifts on hover.
          </Card>
        </div>
        <div className="flex max-w-xl flex-col gap-4">
          <Progress value={0} aria-label="Not started" />
          <Progress value={35} aria-label="35% done" />
          <Progress value={100} aria-label="Done" />
        </div>
        <div className="grid max-w-xl gap-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-24" />
        </div>
      </Section>

      <Section title="Numbers">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Videos analysed" value="3" />
          <StatCard label="Audiences found" value="2" />
          <StatCard label="Beats extracted" value="20" />
          <StatCard
            label="Model error"
            value="Not measured"
            detail="Needs a held-out test"
            hint="How far predicted curves are from real ones on videos the model never saw, against the channel's average curve."
          />
        </div>
        <p className="flex flex-col gap-1">
          <IntervalText delta={4.2} ci={[2.1, 6.3]} />
          <IntervalText delta={-2.1} ci={[-3.4, -0.6]} />
        </p>
      </Section>

      <Section title="Effects">
        <div className="flex max-w-3xl flex-col gap-5">
          {SAMPLE_EFFECTS.map((effect) => (
            <EffectBar
              key={effect.label}
              label={effect.label}
              delta={effect.delta}
              ci={effect.ci}
              domain={domain}
            />
          ))}
        </div>
        <div>
          <SheetDemo />
        </div>
      </Section>

      <Section title="Audiences">
        <ResultNotice reasons={["trained on 3 videos; at least 20 are needed"]} />
        <div className="grid gap-6 lg:grid-cols-3">
          {SAMPLE_CARDS.map((card) => (
            <AudienceCard key={card.key} card={card} />
          ))}
        </div>
      </Section>

      <Section title="Charts">
        <ChartDemo />
      </Section>

      <Section title="Edits">
        <EditDemo />
      </Section>

      <Section title="Soundcheck result">
        <SoundcheckResult doc={SAMPLE_SOUNDCHECK} />
      </Section>
    </main>
  );
}
