import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { recentPrints } from "$/stores/app";
import dayjs from "dayjs";
import { historyFileName, rememberPrintedLabel, sameLabelKey, tidyRecentPrints } from "$/utils/recent_prints";
import type { ExportedLabelTemplate, LabelProps } from "$/types";

const LABEL: LabelProps = {
  printDirection: "top",
  size: { width: 424, height: 112 },
  split: "vertical",
  splitSizeA: 295,
  splitSizeB: 112,
  dpmm: 11.81,
};

type Obj = Record<string, unknown>;

const text = (labelRole: string, value: string, extra: Obj = {}): Obj => ({
  type: "Textbox",
  labelRole,
  text: value,
  fontFamily: "Noto Sans Variable",
  fontWeight: "normal",
  fontStyle: "normal",
  fill: "black",
  left: 148,
  top: 43,
  width: 295,
  fontSize: 36,
  ...extra,
});

const print = (objects: Obj[], label: Partial<LabelProps> = {}, timestamp = 1): ExportedLabelTemplate => ({
  canvas: { version: "7", objects: objects as never },
  label: { ...LABEL, ...label },
  timestamp,
});

const tenXte = (layout: Obj = {}, date = "11/02/2026") => [
  text("primary", "10x TE\n10 mM Tris pH 7.5", layout),
  text("secondary", "10x\nTE", { left: 368 }),
  text("date", date, { width: 120 }),
];

describe("sameLabelKey", () => {
  it("treats a reprint as the same label when only auto-layout or the date changed", () => {
    // What differed between duplicate entries in a real history.
    const first = print(tenXte());
    const again = print([
      text("primary", "10x TE\n10 mM Tris pH 7.5", { fontSize: 37, top: 42.57 }),
      text("secondary", "10x\nTE", { left: 363, gapOffsetX: 5 }),
      text("date", "11/09/2026", { width: 117.04 }),
    ]);
    expect(sameLabelKey(again)).toBe(sameLabelKey(first));
  });

  it("ignores the date settings", () => {
    const withDate = print(tenXte(), { date: { format: "YYYY-MM-DD", daysAhead: 7 } });
    expect(sameLabelKey(withDate)).toBe(sameLabelKey(print(tenXte())));
  });

  it("tells labels apart by their words, font, or size", () => {
    const base = sameLabelKey(print(tenXte()));
    expect(sameLabelKey(print([text("primary", "1x TE"), ...tenXte().slice(1)]))).not.toBe(base);
    expect(sameLabelKey(print(tenXte({ fontFamily: "Barlow Semi Condensed" })))).not.toBe(base);
    expect(sameLabelKey(print(tenXte(), { splitSizeA: 236 }))).not.toBe(base);
  });

  it("counts where hand-placed objects are, with old gap offsets folded in", () => {
    const rect = (extra: Obj): Obj => ({ type: "Rect", width: 20, height: 20, top: 40, ...extra });
    const at335 = sameLabelKey(print([...tenXte(), rect({ left: 335 })]));
    expect(sameLabelKey(print([...tenXte(), rect({ left: 330, gapOffsetX: 5 })]))).toBe(at335);
    expect(sameLabelKey(print([...tenXte(), rect({ left: 345 })]))).not.toBe(at335);
  });
});

describe("history", () => {
  beforeEach(() => recentPrints.set([]));

  it("moves a reprint to the front instead of adding a copy", () => {
    rememberPrintedLabel(print(tenXte(), {}, 1));
    rememberPrintedLabel(print([text("primary", "PBS 1x"), text("date", "11/02/2026")], {}, 2));
    rememberPrintedLabel(print(tenXte({ fontSize: 37 }, "11/05/2026"), {}, 3));
    const list = get(recentPrints);
    expect(list.map((e) => e.timestamp)).toEqual([3, 2]);
  });

  it("reports a first print as new and a reprint as not new", () => {
    expect(rememberPrintedLabel(print(tenXte(), {}, 1)).isNew).toBe(true);
    expect(rememberPrintedLabel(print(tenXte({ fontSize: 37 }, "11/09/2026"), {}, 2)).isNew).toBe(false);
    expect(rememberPrintedLabel(print(tenXte(), { splitSizeA: 236 }, 3)).isNew).toBe(true);
  });

  it("keeps more than the old limit of 20", () => {
    for (let i = 0; i < 30; i++) rememberPrintedLabel(print([text("primary", `Item ${i}`)], {}, i + 1));
    expect(get(recentPrints).length).toBe(30);
  });

  it("merges duplicates saved by older versions, keeping the newest", () => {
    recentPrints.set([
      print(tenXte(), {}, 9),
      print(tenXte({ top: 42 }), {}, 5),
      print([text("primary", "PBS")], {}, 4),
    ]);
    tidyRecentPrints();
    expect(get(recentPrints).map((e) => e.timestamp)).toEqual([9, 4]);
  });
});

describe("historyFileName", () => {
  const day = dayjs("2026-11-02");

  it("is the print date and the first line", () => {
    expect(historyFileName(print(tenXte()), day)).toBe("20261102_10x TE.json");
  });

  it("replaces characters that can't be in a file name and falls back to 'label'", () => {
    expect(historyFileName(print([text("primary", 'A/B: "x"?')]), day)).toBe("20261102_A_B_ _x__.json");
    expect(historyFileName(print([text("primary", "")]), day)).toBe("20261102_label.json");
  });
});
