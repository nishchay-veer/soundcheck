// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentUserId } from "@/lib/session";
import HomePage from "./page";

vi.mock("@/lib/session", () => ({ currentUserId: vi.fn() }));
// The real button posts a server action to Google sign-in.
vi.mock("@/components/auth-buttons", () => ({
  ConnectButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}));

afterEach(() => {
  cleanup();
  vi.mocked(currentUserId).mockReset();
});

const page = async (userId: string | null) => {
  vi.mocked(currentUserId).mockResolvedValue(userId);
  return render(await HomePage());
};

describe("the landing page", () => {
  it("asks a visitor to connect, beside an example soundcheck", async () => {
    await page(null);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Run a soundcheck before you publish",
    );
    // The hero and the closing band.
    expect(screen.getAllByRole("button", { name: "Connect your YouTube channel" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Open your channel" })).toBeNull();
    expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe(
      "#how",
    );
    const example = screen.getByRole("figure");
    expect(within(example).getByText("Example")).toBeTruthy();
    expect(within(example).getByRole("img").getAttribute("aria-label")).toMatch(/^Example:/);
    expect(within(example).getAllByRole("listitem")).toHaveLength(3);
  });

  it("opens the channel for someone signed in", async () => {
    await page("111111111111111111111");
    const links = screen.getAllByRole("link", { name: "Open your channel" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/app", "/app"]);
    expect(screen.queryByRole("button", { name: /Connect/ })).toBeNull();
  });

  it("links only to sections that exist, and answers each question in a closed panel", async () => {
    const { container } = await page(null);
    const footer = screen.getByRole("navigation", { name: "On this page" });
    for (const link of within(footer).getAllByRole("link")) {
      const id = link.getAttribute("href")?.slice(1) ?? "";
      expect(container.querySelector(`#${id}`)?.tagName).toBe("H2");
    }
    const questions = container.querySelectorAll("details");
    expect(questions).toHaveLength(6);
    expect([...questions].every((question) => !question.open)).toBe(true);
    expect(screen.getByText("How many videos do I need?")).toBeTruthy();
    // What is read and how to delete it stay on the page.
    expect(screen.getByRole("heading", { name: "What Soundcheck reads" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How to delete it" })).toBeTruthy();
  });
});
