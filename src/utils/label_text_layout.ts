import dayjs from "dayjs";
import * as fabric from "fabric";
import { TextboxExt } from "$/fabric-object/textbox-ext";

export type TextArea = { x: number; y: number; width: number; height: number };

export const todayStamp = (): string => dayjs().format("MM/DD/YYYY");

export const firstLine = (text: string): string => text.split("\n")[0] ?? "";

export const newlineCount = (text: string): number => {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
};

let probe: TextboxExt | undefined;

const measurer = (sample: TextboxExt): TextboxExt => {
  if (!probe) {
    probe = new TextboxExt(" ", {
      fontFamily: sample.fontFamily,
      fontWeight: sample.fontWeight,
      fontStyle: sample.fontStyle,
      lineHeight: 1,
      width: 100000,
      splitByGrapheme: false,
    });
  }
  probe.set({
    fontFamily: sample.fontFamily,
    fontWeight: sample.fontWeight,
    fontStyle: sample.fontStyle,
    charSpacing: sample.charSpacing,
    lineHeight: 1,
    splitByGrapheme: false,
  });
  return probe;
};

const measure = (sample: TextboxExt, text: string, fontSize: number): number => {
  if (!text) return 0;
  const box = measurer(sample);
  box.set({ text, fontSize, width: 100000 });
  box.initDimensions();
  return box.calcTextWidth();
};

const lineBoxHeight = (sample: TextboxExt, fontSize: number): number => {
  const box = measurer(sample);
  box.set({ text: "Mg", fontSize, width: 100000 });
  box.initDimensions();
  return Math.max(1, box.height);
};

const largestFont = (max: number, fits: (size: number) => boolean): number => {
  const upper = Math.max(2, Math.floor(max));
  let lo = 2;
  let hi = upper;
  let best = 2;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  fits(best);
  return best;
};

const applyCommon = (box: TextboxExt, fontSize: number, width: number) => {
  box.set({
    fontSize,
    width: Math.max(1, width),
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    lineHeight: 1,
    textAlign: "center",
    splitByGrapheme: false,
    originX: "center",
    originY: "center",
    editable: true,
    selectable: true,
    evented: true,
  });
  box.initDimensions();
};

/** Largest font whose word-wrapped block fits the rectangle. Words stay centered. */
export const placeFittedText = (box: TextboxExt, text: string, area: TextArea): void => {
  const maxWidth = Math.max(1, area.width);
  const maxHeight = Math.max(1, area.height);
  largestFont(maxHeight, (fontSize) => {
    if (box.text !== text) box.set({ text });
    applyCommon(box, fontSize, maxWidth);
    if (box.dynamicMinWidth > maxWidth + 0.5) return false;
    return box.height <= maxHeight + 0.5;
  });
  box.setPositionByOrigin(new fabric.Point(area.x + area.width / 2, area.y + area.height / 2), "center", "center");
  box.setCoords();
  box.dirty = true;
};

const chordAt = (centerY: number, y: number, radius: number): number | null => {
  const dy = y - centerY;
  const rest = radius * radius - dy * dy;
  if (rest < 0) return null;
  return 2 * Math.sqrt(rest);
};

const packWords = (
  words: string[],
  widths: number[],
  space: number,
  maxWidthAt: (line: number) => number,
): string[] | null => {
  const lines: string[] = [];
  let index = 0;
  while (index < words.length) {
    const limit = maxWidthAt(lines.length);
    if (!(limit > 0)) return null;
    let used = 0;
    let count = 0;
    while (index + count < words.length) {
      const wordWidth = widths[index + count];
      const next = count === 0 ? wordWidth : used + space + wordWidth;
      if (count > 0 && next > limit + 0.5) break;
      if (count === 0 && wordWidth > limit + 0.5) return null;
      used = next;
      count++;
    }
    if (count === 0) return null;
    lines.push(words.slice(index, index + count).join(" "));
    index += count;
  }
  return lines;
};

/**
 * Wrap on spaces so every line stays inside the inscribed circle.
 * `limitBottom` is the y the text must stay above (the date).
 */
export const placeCircleText = (box: TextboxExt, text: string, piece: TextArea, limitBottom: number): void => {
  const radius = Math.min(piece.width, piece.height) / 2;
  const cx = piece.x + piece.width / 2;
  const cy = piece.y + piece.height / 2;
  const textRadius = Math.max(1, radius - 1);
  const top = cy - textRadius;
  const bottom = Math.min(cy + textRadius, limitBottom);
  const span = Math.max(1, bottom - top);
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);

  let centerY = (top + bottom) / 2;

  largestFont(span, (fontSize) => {
    const lineH = lineBoxHeight(box, fontSize);
    const space = Math.max(measure(box, "n n", fontSize) - 2 * measure(box, "n", fontSize), fontSize * 0.2);
    if (words.length === 0) {
      if (box.text !== "") box.set({ text: "" });
      applyCommon(box, fontSize, textRadius * 2);
      centerY = top + Math.min(box.height, span) / 2;
      return box.height <= span + 0.5;
    }

    const widths = words.map((word) => measure(box, word, fontSize));
    let guess = words.map(() => textRadius * 2);
    let lines: string[] | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const packed = packWords(words, widths, space, (line) => guess[line] ?? 0);
      if (!packed) return false;
      const blockH = packed.length * lineH;
      if (blockH > span + 0.5) return false;
      const blockTop = top + (span - blockH) / 2;
      const next = packed.map((_, i) => {
        const lineTop = blockTop + i * lineH;
        const upper = chordAt(cy, lineTop, textRadius);
        const lower = chordAt(cy, lineTop + lineH, textRadius);
        if (upper === null || lower === null) return -1;
        return Math.min(upper, lower);
      });
      if (next.some((width) => width < 0)) return false;
      const same = lines !== null && lines.length === packed.length && lines.every((line, i) => line === packed[i]);
      lines = packed;
      guess = next;
      if (!same) continue;
      if (lines.some((line, i) => measure(box, line, fontSize) > guess[i] + 0.5)) return false;

      const wrapped = lines.join("\n");
      if (box.text !== wrapped) box.set({ text: wrapped });
      applyCommon(box, fontSize, textRadius * 2);
      if (box.height > span + 0.5) return false;
      const placedTop = top + (span - box.height) / 2;
      const count = Math.max(1, lines.length);
      const step = box.height / count;
      for (let i = 0; i < count; i++) {
        const lineTop = placedTop + i * step;
        const upper = chordAt(cy, lineTop, textRadius);
        const lower = chordAt(cy, lineTop + step, textRadius);
        const lineWidth = measure(box, lines[i] ?? "", fontSize);
        if (upper === null || lower === null || lineWidth > Math.min(upper, lower) + 0.5) return false;
      }
      centerY = placedTop + box.height / 2;
      return true;
    }
    return false;
  });

  box.setPositionByOrigin(new fabric.Point(cx, centerY), "center", "center");
  box.setCoords();
  box.dirty = true;
};

/** Font starts at about 1/5 of the label height, then shrinks until the stamp fits. */
export const sizeDateText = (box: TextboxExt, labelHeight: number, maxWidth: number, maxHeight: number): number => {
  const stamp = todayStamp();
  const widthLimit = Math.max(1, maxWidth);
  const heightLimit = Math.max(1, maxHeight);
  let fontSize = Math.max(2, Math.round(labelHeight / 5));

  const apply = (size: number) => {
    box.set({
      text: stamp,
      fontSize: size,
      width: 100000,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      lineHeight: 1,
      textAlign: "center",
      splitByGrapheme: false,
    });
    box.initDimensions();
  };

  apply(fontSize);
  while (
    fontSize > 2 &&
    (box.calcTextWidth() > widthLimit || box.height > heightLimit || (box.textLines?.length ?? 1) > 1)
  ) {
    fontSize -= 1;
    apply(fontSize);
  }

  box.set({ width: Math.max(1, box.calcTextWidth()) });
  box.initDimensions();
  box.dirty = true;
  return box.height;
};

/** Print copy: keep the fitted size, but show today's date. */
export const refreshDateStamp = (box: TextboxExt, maxWidth: number): void => {
  const stamp = todayStamp();
  const widthLimit = Math.max(1, maxWidth);
  let fontSize = box.fontSize || 2;
  const apply = (size: number) => {
    box.set({ text: stamp, fontSize: size, width: 100000, lineHeight: 1, splitByGrapheme: false });
    box.initDimensions();
  };
  apply(fontSize);
  while (fontSize > 2 && box.calcTextWidth() > widthLimit) {
    fontSize -= 1;
    apply(fontSize);
  }
  box.set({ width: Math.max(1, box.calcTextWidth()) });
  box.initDimensions();
  box.dirty = true;
};
