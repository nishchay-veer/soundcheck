import { Badge } from "@soundcheck/ui/components/badge";
import { buttonVariants } from "@soundcheck/ui/components/button";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import {
  AudioWaveform,
  Plug,
  Plus,
  ScanSearch,
  Scissors,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { ConnectButton } from "@/components/auth-buttons";
import { HeroPreview } from "@/components/hero-preview";
import { currentUserId } from "@/lib/session";

/*
 * The landing page. Every claim on it is true of the code: what is read, the
 * video minimum, the upload limits, the ranges and what is deleted. The
 * example soundcheck is labelled as one.
 */

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Plug,
    title: "Connect your channel",
    text: "Sign in with Google. Soundcheck reads how subscribers and newcomers watched your own videos, and Gemini marks each video's beats.",
  },
  {
    icon: Upload,
    title: "Soundcheck a new cut",
    text: "Upload a rough cut, or link a public or unlisted video. A few minutes later, see how long each audience is predicted to watch, with a range.",
  },
  {
    icon: Scissors,
    title: "Try edits, then export",
    text: "Tick suggested cuts, trims and moves to see the predicted change, then take a cut list to your editor and chapters to YouTube.",
  },
];

const FEATURES: { icon: LucideIcon; strip: string; title: string; text: string }[] = [
  {
    icon: Users,
    strip: "bg-aud-subscribers",
    title: "Who watches, and how",
    text: "Your subscribers and newcomers side by side: their share of views and watch time, how much of a video each watches, and the traits that keep or lose them.",
  },
  {
    icon: ScanSearch,
    strip: "bg-aud-newcomers",
    title: "Where viewers left, and why",
    text: "Each video's curve for each audience over its beats, its biggest drop-offs, what the model links them to, and how much it can't explain.",
  },
  {
    icon: AudioWaveform,
    strip: "bg-beat-opening",
    title: "A new cut, predicted",
    text: "Before you publish: each audience's predicted curve and average view for a rough cut, for the traffic you expect.",
  },
  {
    icon: Scissors,
    strip: "bg-beat-promotion",
    title: "Edits worth making",
    text: "Cut, trim or move beats and watch the prediction change. An edit is recommended only when its whole range is a gain; the rest are marked uncertain.",
  },
];

const HONEST = [
  {
    title: "A range on every number",
    text: "Each prediction is the middle 80% of 200 simulations, so you can see how sure it is.",
  },
  {
    title: "“Not a result yet” until it is",
    text: "Until your model has learned from enough of your videos, at least 20, every screen says so.",
  },
  {
    title: "The part it can't explain",
    text: "Every drop-off shows how much of it the model can't link to anything in the video.",
  },
];

/** What Soundcheck reads, in plain words; every item is true of the code. */
const READS = [
  "Your channel's videos and their public details: titles, lengths and thumbnails.",
  "YouTube Analytics for each video: views, watch time, how long subscribers and newcomers kept watching, and where viewers came from.",
  "The videos themselves: Gemini, Google's AI model, watches each public video to mark its beats, such as the hook, a sponsor read or the payoff.",
];

const FAQS: { question: string; answer: string }[] = [
  {
    question: "How many videos do I need?",
    answer:
      "At least 20 that YouTube has a full retention curve for. A video counts when it isn't a Short, is at least a week old, lasts between 1 minute and 3 hours, and has at least 200 views. With fewer, you can still look around: every screen is marked “Not a result yet”.",
  },
  {
    question: "Does Soundcheck change my videos?",
    answer:
      "No. Its access to YouTube is read-only: it never posts, edits or sees monetization data. It predicts and suggests; you make the edits in your own editor.",
  },
  {
    question: "What happens to the cuts I upload?",
    answer:
      "A rough cut is used only for its soundcheck and deleted after 30 days. Files can be MP4, MOV or WebM, up to 2 GB and 1 to 60 minutes long. You can link a public or unlisted video instead.",
  },
  {
    question: "How accurate is it?",
    answer:
      "Every number comes with its range, and edits are compared on the same simulations, so small differences stay honest. Once your channel has 26 videos at least 14 days old, the model is also tested on videos it never saw, against your channel's average curve.",
  },
  {
    question: "Does it work with Shorts?",
    answer:
      "Not yet. Shorts loop and are watched in a feed, so they behave differently and are left out.",
  },
  {
    question: "Who can see my channel's data?",
    answer:
      "Only you, signed in with the Google account that connected the channel. You can disconnect and delete everything at any time.",
  },
];

const heading = "font-heading text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]";
const card = "rounded-[4px] border-2 border-ink bg-surface";

function SectionHeader({ id, title, text }: { id: string; title: string; text?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h2 id={id} className={cn(heading, "scroll-mt-6")}>
        {title}
      </h2>
      {text ? <p className="text-lg text-ink-muted">{text}</p> : null}
    </div>
  );
}

export default async function HomePage() {
  const userId = await currentUserId();
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col px-4 sm:px-6">
      <section className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-6">
          <Badge>In development</Badge>
          <h1 className="font-heading text-[44px] leading-[1.02] font-bold tracking-tight sm:text-[60px] lg:text-[64px]">
            Run a soundcheck before you publish
          </h1>
          <p className="max-w-xl text-lg text-ink-muted sm:text-xl">
            Soundcheck learns how your subscribers and newcomers actually watch, from your own
            videos, then predicts how a new cut will hold each of them, with an honest margin of
            error, and which edits would help.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {userId ? (
              <Link href="/app" className={buttonVariants()}>
                Open your channel
              </Link>
            ) : (
              <ConnectButton label="Connect your YouTube channel" />
            )}
            <a href="#how" className={buttonVariants({ variant: "secondary" })}>
              See how it works
            </a>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
            <li className="flex items-center gap-1.5">
              <ShieldCheck aria-hidden="true" className="size-4 text-ink" />
              Read-only YouTube access
            </li>
            <li className="flex items-center gap-1.5">
              <Trash2 aria-hidden="true" className="size-4 text-ink" />
              Delete everything in one step
            </li>
          </ul>
        </div>
        <div className="rounded-[4px] border-2 border-ink bg-highlight p-3 sm:p-6">
          <HeroPreview />
        </div>
      </section>

      <section
        aria-labelledby="how"
        className="flex flex-col gap-8 border-t-2 border-ink py-14 sm:py-20"
      >
        <SectionHeader
          id="how"
          title="How it works"
          text="From your channel's history to a better cut, in three steps."
        />
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className={cn(card, "flex flex-col gap-4 p-5 sm:p-6")}>
              <div className="flex items-center justify-between">
                <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink bg-accent font-heading text-xl font-bold">
                  {index + 1}
                </span>
                <step.icon aria-hidden="true" className="size-6" />
              </div>
              <h3 className="font-heading text-[22px] leading-tight font-bold tracking-tight">
                {step.title}
              </h3>
              <p className="text-ink-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="features"
        className="flex flex-col gap-8 border-t-2 border-ink py-14 sm:py-20"
      >
        <SectionHeader
          id="features"
          title="What you get"
          text="Built from your own videos, and the model your channel trains on them."
        />
        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.title} className={cn(card, "flex flex-col overflow-hidden")}>
              <span aria-hidden="true" className={cn("h-3 border-b-2 border-ink", feature.strip)} />
              <div className="flex flex-col gap-3 p-5 sm:p-6">
                <feature.icon aria-hidden="true" className="size-6" />
                <h3 className="font-heading text-[22px] leading-tight font-bold tracking-tight">
                  {feature.title}
                </h3>
                <p className="text-ink-muted">{feature.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="honest"
        className="flex flex-col gap-8 border-t-2 border-ink py-14 sm:py-20"
      >
        <SectionHeader
          id="honest"
          title="Honest about what it knows"
          text="A prediction is only useful if you know how far to trust it."
        />
        <ul className={cn(card, "grid divide-ink max-md:divide-y-2 md:grid-cols-3 md:divide-x-2")}>
          {HONEST.map((item) => (
            <li key={item.title} className="flex flex-col gap-2 p-5 sm:p-6">
              <h3 className="font-heading text-xl leading-tight font-bold tracking-tight">
                {item.title}
              </h3>
              <p className="text-ink-muted">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="your-data"
        className="flex flex-col gap-8 border-t-2 border-ink py-14 sm:py-20"
      >
        <SectionHeader id="your-data" title="Your data" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className={cn(card, "flex flex-col gap-4 p-5 sm:p-6")}>
            <h3 className="font-heading text-[22px] leading-tight font-bold tracking-tight">
              What Soundcheck reads
            </h3>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {READS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-ink-muted">
              Access is read-only: Soundcheck never posts, edits or sees monetization data. Only you
              can see your channel&apos;s screens.
            </p>
          </div>
          <div className={cn(card, "flex flex-col gap-4 p-5 sm:p-6")}>
            <h3 className="font-heading text-[22px] leading-tight font-bold tracking-tight">
              How to delete it
            </h3>
            <p>
              Open <strong>Channel</strong> and choose <strong>Disconnect and delete data</strong>.
              Soundcheck revokes its access to your YouTube account and deletes your channel&apos;s
              screens, analytics tables and files.
            </p>
            <p className="text-ink-muted">
              Rough cuts you upload are deleted after 30 days on their own.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="faq"
        className="flex flex-col gap-8 border-t-2 border-ink py-14 sm:py-20"
      >
        <SectionHeader id="faq" title="Questions" />
        <div className={cn(card, "divide-y-2 divide-ink")}>
          {FAQS.map((faq) => (
            <details key={faq.question} className="group">
              <summary
                className={cn(
                  "flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-heading text-lg font-bold tracking-tight sm:px-6 [&::-webkit-details-marker]:hidden",
                  FOCUS_RING,
                )}
              >
                {faq.question}
                <Plus aria-hidden="true" className="size-5 shrink-0 group-open:rotate-45" />
              </summary>
              <p className="max-w-3xl px-5 pb-5 text-ink-muted sm:px-6">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-6 border-t-2 border-ink py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-xl font-bold tracking-tight">Soundcheck</span>
          <span className="text-sm text-ink-muted">
            Predicts how each of your audiences will watch your next video.
          </span>
        </div>
        <nav aria-label="On this page">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {[
              ["#how", "How it works"],
              ["#features", "What you get"],
              ["#your-data", "Your data"],
              ["#faq", "Questions"],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} className={cn("underline underline-offset-4", FOCUS_RING)}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </main>
  );
}
