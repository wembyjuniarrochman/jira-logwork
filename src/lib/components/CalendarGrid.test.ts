import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import CalendarGrid from "./CalendarGrid.svelte";
import { setLang } from "../stores/i18n.svelte";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("week national holidays", () => {
  it.each(["2026-08-17", "2026-09-10"])("marks 17 August as a holiday when navigating from %s", async (selectedDate) => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    setLang("en");
    const { container } = render(CalendarGrid, { props: {
      selectedDate, worklogsByDate: {}, onSelectDate: vi.fn(),
    } });
    await fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    if (selectedDate === "2026-09-10") {
      for (let i = 0; i < 3; i++) {
        await fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
      }
    }
    const headers = container.querySelectorAll(".timeline-day-col-header");
    expect(headers[1]).toHaveTextContent("17");
    expect(headers[1]).toHaveClass("holiday-national");
    expect(headers[1]).toHaveAttribute("title", "Hari Kemerdekaan RI");
    expect(headers[1].querySelector(".week-holiday-name")).toHaveTextContent("Hari Kemerdekaan RI");
    expect(headers[2].querySelector(".week-holiday-name")).toBeNull();
    const columns = container.querySelectorAll(".day-column");
    expect(columns[1]).toHaveClass("holiday-national");
    expect(columns[1]).not.toHaveClass("weekend");
    expect(columns[2]).not.toHaveClass("holiday-national");
  });

  it("does not mark an ordinary worklog as holiday because its comment mentions holidays", async () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    setLang("en");
    const { container } = render(CalendarGrid, { props: {
      selectedDate: "2026-08-27",
      worklogsByDate: {
        "2026-08-27": {
          totalHours: 4,
          entries: [{
            id: "1",
            issueKey: "JMI-261",
            hours: 4,
            started: "2026-08-27T07:00:00.000+0700",
            description: "Weekly target after deducting holidays",
          }],
        },
      },
      onSelectDate: vi.fn(),
    } });

    await fireEvent.click(screen.getByRole("radio", { name: "Day" }));
    const worklog = container.querySelector(".worklog-block");
    expect(worklog).toHaveClass("default");
    expect(worklog).not.toHaveClass("holiday");
  });
});

describe("localized calendar dates", () => {
  it("updates weekday names when the app language changes", async () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    setLang("en");
    const { container } = render(CalendarGrid, { props: {
      selectedDate: "2026-09-10",
      worklogsByDate: {},
      onSelectDate: vi.fn(),
    } });

    expect(container.querySelector(".weekday-label")?.textContent).toMatch(/^Sun/i);
    setLang("id");
    await tick();
    expect(container.querySelector(".weekday-label")?.textContent).toMatch(/^Min/i);

    await fireEvent.click(screen.getByRole("radio", { name: "Minggu" }));
    expect(container.querySelector(".timeline-day-col-header .day-name")?.textContent).toMatch(/^Min/i);
  });
});

describe("daily target shortfall", () => {
  it("marks only elapsed working days below the configured target", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    setLang("en");
    const { container } = render(CalendarGrid, { props: {
      selectedDate: "2026-09-10",
      baseline: 8,
      worklogsByDate: {
        "2026-09-08": { totalHours: 6, entries: [] },
      },
      onSelectDate: vi.fn(),
    } });

    const september8 = container.querySelector('[data-date="2026-09-08"]');
    const futureDay = container.querySelector('[data-date="2026-09-11"]');
    const weekend = container.querySelector('[data-date="2026-09-06"]');

    expect(september8).toHaveClass("under-target");
    expect(september8?.querySelector(".missing-value")).toHaveTextContent("−2.0h");
    expect(futureDay).not.toHaveClass("under-target");
    expect(weekend).not.toHaveClass("under-target");
  });

  it("does not mark a national holiday as missing hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const { container } = render(CalendarGrid, { props: {
      selectedDate: "2026-08-17",
      baseline: 8,
      worklogsByDate: {},
      onSelectDate: vi.fn(),
    } });

    const independenceDay = container.querySelector('[data-date="2026-08-17"]');
    expect(independenceDay).toHaveClass("holiday-national");
    expect(independenceDay).not.toHaveClass("under-target");
  });
});
