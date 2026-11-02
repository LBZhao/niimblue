import { RECENT_PRINTS_LIMIT } from "$/defaults";
import { recentPrints } from "$/stores";
import type { ExportedLabelTemplate } from "$/types";

type SerializedText = { labelRole?: string; text?: string };

/** Two prints are the same label when only the date differs. */
const sameLabelKey = (tpl: ExportedLabelTemplate): string =>
  JSON.stringify({
    label: tpl.label,
    csv: tpl.csv,
    objects: tpl.canvas.objects.map((o) => {
      const obj = o as unknown as SerializedText;
      return obj.labelRole === "date" ? { ...obj, text: "" } : obj;
    }),
  });

/** Put the printed label first. A reprint moves the older copy instead of adding another. */
export const rememberPrintedLabel = (tpl: ExportedLabelTemplate): void => {
  const key = sameLabelKey(tpl);
  recentPrints.update((list) => [tpl, ...list.filter((e) => sameLabelKey(e) !== key)].slice(0, RECENT_PRINTS_LIMIT));
};

/** Short name for a recent print: its title, or the first line of the main text. */
export const recentPrintName = (tpl: ExportedLabelTemplate): string => {
  if (tpl.title) return tpl.title;
  const objects = tpl.canvas.objects as unknown as SerializedText[];
  const main = objects.find((o) => o.labelRole === "primary") ?? objects.find((o) => typeof o.text === "string");
  return (main?.text ?? "").split("\n")[0];
};
