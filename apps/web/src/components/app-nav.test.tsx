// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppNav } from "./app-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/audiences" }));
vi.mock("@/lib/actions", () => ({ chooseChannel: vi.fn() }));

afterEach(cleanup);

const ONE = [{ id: "UCaBcDeFgHiJkLmNoPqRsTuV", title: "Mine" }];

describe("AppNav", () => {
  it("marks the current screen, and shows screens still to come without links", () => {
    render(<AppNav channels={ONE} currentId={ONE[0]?.id ?? null} />);
    const audiences = screen.getByRole("link", { name: "Audiences" });
    expect(audiences.getAttribute("aria-current")).toBe("page");
    expect(audiences.className).toContain("bg-accent");
    for (const name of ["Videos", "Soundcheck", "Model"]) {
      expect(screen.queryByRole("link", { name: new RegExp(name) })).toBeNull();
      expect(screen.getByText(name).getAttribute("aria-disabled")).toBe("true");
    }
    expect(screen.getByRole("link", { name: "Channel" }).getAttribute("href")).toBe(
      "/app/settings",
    );
  });

  it("offers a channel switcher only with more than one channel", () => {
    render(<AppNav channels={ONE} currentId={ONE[0]?.id ?? null} />);
    expect(screen.queryByRole("combobox", { name: "Channel" })).toBeNull();
    cleanup();
    const two = [...ONE, { id: "UCzYxWvUtSrQpOnMlKjIhGfE", title: "Other" }];
    render(<AppNav channels={two} currentId="UCzYxWvUtSrQpOnMlKjIhGfE" />);
    const select = screen.getByRole("combobox", { name: "Channel" }) as HTMLSelectElement;
    expect(select.value).toBe("UCzYxWvUtSrQpOnMlKjIhGfE");
    expect([...select.options].map((option) => option.text)).toEqual(["Mine", "Other"]);
  });
});
