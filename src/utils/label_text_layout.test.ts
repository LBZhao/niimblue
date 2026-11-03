import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATE_FORMATS, dateStamp, firstLine, newlineCount, secondaryText } from "$/utils/label_text_layout";

describe("dateStamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("defaults to today as MM/DD/YYYY", () => {
    expect(DATE_FORMATS[0]).toBe("MM/DD/YYYY");
    expect(dateStamp()).toBe("11/02/2026");
  });

  it("uses the chosen format", () => {
    expect(dateStamp({ format: "YYYY-MM-DD" })).toBe("2026-11-02");
    expect(dateStamp({ format: "MMM D, YYYY" })).toBe("Nov 2, 2026");
  });

  it("adds days ahead, across month ends", () => {
    expect(dateStamp({ daysAhead: 7 })).toBe("11/09/2026");
    expect(dateStamp({ daysAhead: 30, format: "YYYY-MM-DD" })).toBe("2026-12-02");
  });
});

describe("secondaryText", () => {
  it("stacks one or two words, one per line", () => {
    expect(secondaryText("test ests")).toEqual({ text: "test\nests", stacked: true });
    expect(secondaryText("Flour")).toEqual({ text: "Flour", stacked: false });
  });

  it("keeps three or more words on one line for packing", () => {
    expect(secondaryText("Basmati brown rice")).toEqual({ text: "Basmati brown rice", stacked: false });
  });

  it("only uses the first line of the main text", () => {
    expect(secondaryText("10x TE\n10 mM Tris pH 7.5").text).toBe("10x\nTE");
    expect(firstLine("a\nb")).toBe("a");
    expect(newlineCount("a\nb\nc")).toBe(2);
  });
});
