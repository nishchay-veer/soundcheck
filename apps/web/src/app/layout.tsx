import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { fixturesMode } from "@soundcheck/core/env";
import { SignOutButton } from "@/components/auth-buttons";
import { currentUserId } from "@/lib/session";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-space-grotesk",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Soundcheck",
  description: "Predict how each of your audiences will watch a new cut before you publish it.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const fixtures = fixturesMode();
  const signedIn = !fixtures && (await currentUserId()) !== null;
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">
        <header className="border-b-2 border-ink">
          <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
            <Link href="/" className="font-heading text-xl font-bold tracking-tight">
              Soundcheck
            </Link>
            {fixtures ? (
              <span className="rounded-full border-2 border-ink bg-highlight px-3 py-1 text-sm font-medium">
                Fixture data
              </span>
            ) : signedIn ? (
              <SignOutButton />
            ) : null}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
