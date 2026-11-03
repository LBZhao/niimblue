import { get } from "svelte/store";
import { recentPrints } from "$/stores";
import type { ExportedLabelTemplate } from "$/types";

type SerializedObject = Record<string, unknown> & {
  labelRole?: string;
  text?: string;
  left?: number;
  top?: number;
  gapOffsetX?: number;
  gapOffsetY?: number;
};

/** What identifies text the label fits by itself; its size and place are computed. */
const MANAGED_TEXT_FIELDS = ["type", "labelRole", "text", "fontFamily", "fontWeight", "fontStyle", "fill"];

/** Round numbers so tiny float differences don't make two labels look different. */
const rounded = (value: unknown): unknown => {
  if (typeof value === "number") return Math.round(value * 10) / 10;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  }
  return value;
};

/** One object as it matters for "is this the same label". */
const objectKey = (o: SerializedObject): unknown => {
  // The date: only that the label has one. Its text and settings change by design.
  if (o.labelRole === "date") return { type: o.type, labelRole: o.labelRole };
  // Main text and its copy: the words and font, wherever the fitter happened to put them.
  if (o.labelRole) return Object.fromEntries(MANAGED_TEXT_FIELDS.map((k) => [k, o[k]]));
  // Objects placed by hand: where they are matters. Fold in offsets from the old collapsed-gap editor.
  const { gapOffsetX, gapOffsetY, ...rest } = o;
  return rounded({ ...rest, left: (o.left ?? 0) + (gapOffsetX ?? 0), top: (o.top ?? 0) + (gapOffsetY ?? 0) });
};

/** Two prints are the same label when they differ only in the date or in auto-layout. */
export const sameLabelKey = (tpl: ExportedLabelTemplate): string => {
  // Date settings (format, days ahead) don't make it a different label.
  const label = { ...tpl.label };
  delete label.date;
  return JSON.stringify({
    label: rounded(label),
    csv: tpl.csv,
    objects: (tpl.canvas.objects as unknown as SerializedObject[]).map(objectKey),
  });
};

/** Newest first, one entry per label. */
const dedupe = (list: ExportedLabelTemplate[]): ExportedLabelTemplate[] => {
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = sameLabelKey(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");

/**
 * Save the list, dropping the oldest entries if browser storage is full.
 * Returns how many were dropped.
 */
const saveWithinStorage = (list: ExportedLabelTemplate[]): number => {
  for (let keep = list.length; keep > 0; keep--) {
    try {
      recentPrints.set(list.slice(0, keep));
      return list.length - keep;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }
  recentPrints.set([]);
  return list.length;
};

/**
 * Put the printed label first. A reprint moves the older copy instead of adding another.
 * All history is kept; returns how many old entries had to go to make room, usually 0.
 */
export const rememberPrintedLabel = (tpl: ExportedLabelTemplate): number => {
  const key = sameLabelKey(tpl);
  return saveWithinStorage([tpl, ...get(recentPrints).filter((e) => sameLabelKey(e) !== key)]);
};

/** Merge entries saved before labels were compared by content. Safe to run on every start. */
export const tidyRecentPrints = (): void => {
  const list = get(recentPrints);
  const unique = dedupe(list);
  if (unique.length !== list.length) saveWithinStorage(unique);
};

/** Short name for a recent print: its title, or the first line of the main text. */
export const recentPrintName = (tpl: ExportedLabelTemplate): string => {
  if (tpl.title) return tpl.title;
  const objects = tpl.canvas.objects as unknown as SerializedObject[];
  const main = objects.find((o) => o.labelRole === "primary") ?? objects.find((o) => typeof o.text === "string");
  return (main?.text ?? "").split("\n")[0];
};
