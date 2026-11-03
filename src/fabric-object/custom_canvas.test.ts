import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fabric from "fabric";
import "$/styles/font.scss";
// stores and file_utils import each other; load stores first, as the app does.
import "$/stores";
import { CustomCanvas } from "$/fabric-object/custom_canvas";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import { configureFabric, THUMBNAIL_HEIGHT } from "$/defaults";
import { FileUtils } from "$/utils/file_utils";
import { dateStamp } from "$/utils/label_text_layout";
import type { LabelProps } from "$/types";

/** Your split label at 300 dpi: 25 mm rounded piece, 9.5 mm dot, 36.5 x 9.5 mm overall. */
const SPLIT: LabelProps = {
  printDirection: "top",
  size: { width: 424, height: 112 },
  shape: "rect",
  shapeA: "rounded_rect",
  shapeB: "circle",
  split: "vertical",
  splitParts: 2,
  splitSizeA: 295,
  splitSizeB: 112,
  tailPos: "right",
  tailLength: 0,
  mirror: "none",
  dpmm: 11.81,
};

/** 50 x 15 mm at 300 dpi. */
const PLAIN_50x15: LabelProps = {
  printDirection: "top",
  size: { width: 584, height: 177 },
  shape: "rounded_rect",
  split: "none",
  dpmm: 11.81,
};

const EDGE_MARGIN = 3;
const canvases: CustomCanvas[] = [];

const editor = (props: LabelProps, text: string): CustomCanvas => {
  const el = document.createElement("canvas");
  document.body.appendChild(el);
  const canvas = new CustomCanvas(el, { width: props.size.width, height: props.size.height });
  canvas.defaultLabelText = text;
  canvas.setLabelProps(props);
  canvases.push(canvas);
  return canvas;
};

/** The print path: a fresh canvas laid out on the real pieces. */
const printed = async (props: LabelProps, from: CustomCanvas): Promise<CustomCanvas> => {
  const canvas = new CustomCanvas(undefined, { width: props.size.width, height: props.size.height });
  canvas.setCustomBackground(false);
  canvas.setLabelProps(props);
  await canvas.loadFromJSON(from.toJSON());
  canvas.layoutManagedTextForOutput();
  canvases.push(canvas);
  return canvas;
};

const role = (canvas: CustomCanvas, r: "primary" | "secondary" | "date"): TextboxExt | undefined =>
  canvas.getObjects().find((o): o is TextboxExt => o instanceof TextboxExt && o.labelRole === r);

/** Box edges from its own size. Fabric's own bounds add an invisible 1 px text stroke. */
const edges = (o: fabric.FabricObject) => {
  const c = o.getCenterPoint();
  const w = o.width * (o.scaleX ?? 1);
  const h = o.height * (o.scaleY ?? 1);
  return { left: c.x - w / 2, right: c.x + w / 2, top: c.y - h / 2, bottom: c.y + h / 2, centerX: c.x };
};

const typeInto = (canvas: CustomCanvas, text: string) => {
  const box = role(canvas, "primary")!;
  box.set({ text });
  canvas.fire("text:changed", { target: box } as never);
};

beforeAll(async () => {
  configureFabric();
  await document.fonts.load('400 40px "Noto Sans Variable"');
});

afterEach(() => {
  canvases.splice(0).forEach((c) => c.dispose());
  document.querySelectorAll(".canvas-container").forEach((e) => e.remove());
});

describe("split label: main text", () => {
  for (const text of ["Text", "test ests", "Basmati rice", "10x TE\n10 mM Tris pH 7.5\n0.1 mM EDTA"]) {
    it(`stays inside the main piece and above the date: ${JSON.stringify(text)}`, () => {
      const canvas = editor(SPLIT, text);
      const main = edges(role(canvas, "primary")!);
      const date = edges(role(canvas, "date")!);
      expect(main.left).toBeGreaterThanOrEqual(-1);
      expect(main.right).toBeLessThanOrEqual(SPLIT.splitSizeA! + 1);
      expect(main.top).toBeGreaterThanOrEqual(EDGE_MARGIN - 1);
      expect(main.bottom).toBeLessThanOrEqual(date.top + 1);
      expect(date.bottom).toBeLessThanOrEqual(SPLIT.size.height - EDGE_MARGIN + 1);
    });
  }

  it("never runs into the date while typing, and grows back when text is deleted", () => {
    const canvas = editor({ ...SPLIT, splitSizeA: 236 }, "test");
    const startSize = role(canvas, "primary")!.fontSize;
    for (const text of ["test ", "test e", "test es", "test est", "test ests", "test longerword"]) {
      typeInto(canvas, text);
      const main = edges(role(canvas, "primary")!);
      expect(main.bottom, text).toBeLessThanOrEqual(edges(role(canvas, "date")!).top + 1);
    }
    typeInto(canvas, "test");
    expect(role(canvas, "primary")!.fontSize).toBe(startSize);
  });
});

describe("split label: dot", () => {
  it("stacks a two-word name one word per line inside the circle", async () => {
    const canvas = editor(SPLIT, "test ests");
    const out = await printed(SPLIT, canvas);
    const dot = role(out, "secondary")!;
    expect(dot.text).toBe("test\nests");
    const b = edges(dot);
    const pieceX = SPLIT.size.width - SPLIT.splitSizeB!;
    expect(b.left).toBeGreaterThanOrEqual(pieceX - 1);
    expect(b.right).toBeLessThanOrEqual(SPLIT.size.width + 1);
    expect(b.top).toBeGreaterThanOrEqual(EDGE_MARGIN - 1);
    expect(b.bottom).toBeLessThanOrEqual(SPLIT.size.height - EDGE_MARGIN + 1);
  });

  it("prints the main text centred on the real main piece and the copy on the real dot", async () => {
    const out = await printed(SPLIT, editor(SPLIT, "Flour"));
    expect(Math.abs(edges(role(out, "primary")!).centerX - SPLIT.splitSizeA! / 2)).toBeLessThan(2);
    const dotCenter = SPLIT.size.width - SPLIT.splitSizeB! / 2;
    expect(Math.abs(edges(role(out, "secondary")!).centerX - dotCenter)).toBeLessThan(2);
  });
});

describe("date options", () => {
  it("removes the date when it is hidden and gives the space to the main text", () => {
    const withDate = edges(role(editor(PLAIN_50x15, "Brown sugar"), "primary")!);
    const canvas = editor({ ...PLAIN_50x15, date: { show: false } }, "Brown sugar");
    expect(role(canvas, "date")).toBeUndefined();
    expect(edges(role(canvas, "primary")!).bottom).toBeGreaterThan(withDate.bottom);
  });

  it("prints days ahead in the chosen format on one line", async () => {
    const props = { ...PLAIN_50x15, date: { format: "MMM D, YYYY", daysAhead: 7 } };
    const out = await printed(props, editor(props, "Brown sugar"));
    const date = role(out, "date")!;
    expect(date.text).toBe(dateStamp({ format: "MMM D, YYYY", daysAhead: 7 }));
    expect(date.textLines.length).toBe(1);
  });
});

describe("edge margin", () => {
  it("keeps three lines on a 50 x 15 label off the top and bottom edges", () => {
    const canvas = editor(PLAIN_50x15, "10x TE\n10 mM Tris pH 7.5\n0.1 mM EDTA");
    expect(edges(role(canvas, "primary")!).top).toBeGreaterThanOrEqual(EDGE_MARGIN - 1);
    expect(edges(role(canvas, "date")!).bottom).toBeLessThanOrEqual(PLAIN_50x15.size.height - EDGE_MARGIN + 1);
  });
});

describe("editor view", () => {
  it("shows a 1 mm gap between split pieces and fits the screen width", () => {
    const canvas = editor(SPLIT, "Text");
    const realGap = SPLIT.size.width - SPLIT.splitSizeA! - SPLIT.splitSizeB!;
    expect(canvas.editorWidth()).toBe(SPLIT.size.width - realGap + Math.round(SPLIT.dpmm!));
    canvas.fitToWidth(300);
    expect(canvas.getVirtualZoom()).toBeCloseTo(300 / canvas.editorWidth(), 3);
    canvas.fitToWidth(10_000);
    expect(canvas.getVirtualZoom()).toBe(1);
  });
});

describe("thumbnails", () => {
  it("are drawn at the label's real size, with grey liner instead of black", async () => {
    const canvas = editor(SPLIT, "Flour");
    const tpl = FileUtils.makeExportedLabel(canvas, SPLIT, false);
    const img = new Image();
    img.src = tpl.thumbnailBase64!;
    await img.decode();
    expect(img.naturalHeight).toBe(THUMBNAIL_HEIGHT);

    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const scale = img.naturalWidth / SPLIT.size.width;
    // Middle of the real gap between the pieces.
    const gapX = Math.round(
      (SPLIT.splitSizeA! + (SPLIT.size.width - SPLIT.splitSizeB! - SPLIT.splitSizeA!) / 2) * scale,
    );
    const [r] = ctx.getImageData(gapX, Math.round(img.naturalHeight / 2), 1, 1).data;
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(220);
  });
});
