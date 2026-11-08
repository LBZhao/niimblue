import { OBJECT_DEFAULTS_TEXT } from "$/defaults";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fabric from "fabric";
import "$/styles/font.scss";
// stores and file_utils import each other; load stores first, as the app does.
import "$/stores/app";
import { CustomCanvas } from "$/fabric-object/custom_canvas";
import { DEFAULT_TEXT, TextboxExt } from "$/fabric-object/textbox-ext";
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

/** What the on-screen keyboard does: change the hidden field, then Fabric reads it. */
const type = (box: TextboxExt, text: string) => {
  const field = box.hiddenTextarea!;
  field.value = text;
  field.selectionStart = text.length;
  field.selectionEnd = text.length;
  field.dispatchEvent(new InputEvent("input", { bubbles: true }));
};

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

describe("side margin", () => {
  const LONG = "Tetramethylethylenediamine";
  // Font sizes are whole numbers, so one word may land inside the margin by luck. Try many widths.
  const WORDS = Array.from({ length: 16 }, (_, i) => LONG.slice(0, 11 + i));

  for (const [name, props] of [
    ["single label", PLAIN_50x15],
    ["main piece of a split label", SPLIT],
  ] as const) {
    it(`keeps the text and the date off the left and right edges: ${name}`, () => {
      const width = props.splitSizeA ?? props.size.width;
      for (const word of WORDS) {
        const canvas = editor(props, word);
        for (const box of [role(canvas, "primary")!, role(canvas, "date")!]) {
          const center = box.getCenterPoint().x;
          const half = box.calcTextWidth() / 2;
          expect(center - half).toBeGreaterThanOrEqual(EDGE_MARGIN - 0.5);
          expect(center + half).toBeLessThanOrEqual(width - EDGE_MARGIN + 0.5);
        }
      }
    });
  }

  it("still keeps the margin on the printed label", async () => {
    const out = await printed(PLAIN_50x15, editor(PLAIN_50x15, LONG));
    const main = role(out, "primary")!;
    expect(main.calcTextWidth()).toBeLessThanOrEqual(PLAIN_50x15.size.width - 2 * EDGE_MARGIN + 0.5);
  });
});

describe("font size cap", () => {
  const cap = (props: LabelProps) => Math.floor(props.size.height / 3);

  for (const [name, props] of [
    ["single label", PLAIN_50x15],
    ["split label", SPLIT],
  ] as const) {
    it(`keeps short text at one third of the height: ${name}`, () => {
      expect(role(editor(props, "Hi"), "primary")!.fontSize).toBe(cap(props));
    });
  }

  it("caps the copy on the dot too", () => {
    expect(role(editor(SPLIT, "Hi"), "secondary")!.fontSize).toBeLessThanOrEqual(cap(SPLIT));
  });

  it("still shrinks text that does not fit at the cap", () => {
    const size = role(editor(PLAIN_50x15, "Tetramethylethylenediamine solution in water"), "primary")!.fontSize;
    expect(size).toBeLessThan(cap(PLAIN_50x15));
  });

  it("holds on the printed label", async () => {
    const out = await printed(PLAIN_50x15, editor(PLAIN_50x15, "Hi"));
    expect(role(out, "primary")!.fontSize).toBe(cap(PLAIN_50x15));
  });

  it("holds after deleting text while typing", () => {
    const canvas = editor(PLAIN_50x15, "Tetramethylethylenediamine");
    const main = role(canvas, "primary")!;
    main.enterEditing();
    type(main, "Hi");
    expect(main.fontSize).toBeLessThanOrEqual(cap(PLAIN_50x15));
    main.exitEditing();
  });
});

describe("placeholder", () => {
  it("empties the main text and its copy when editing starts", () => {
    const canvas = editor(SPLIT, "Text");
    const main = role(canvas, "primary")!;
    main.enterEditing();
    expect(main.text).toBe("");
    expect(main.hiddenTextarea!.value).toBe("");
    expect(role(canvas, "secondary")!.text).toBe("");
    main.exitEditing();
  });

  it("keeps what is typed", () => {
    const canvas = editor(SPLIT, "Text");
    const main = role(canvas, "primary")!;
    main.enterEditing();
    type(main, "PBS");
    main.exitEditing();
    expect(main.text).toBe("PBS");
    expect(role(canvas, "secondary")!.text).toBe("PBS");
  });

  it("comes back if nothing is typed, without counting as an edit", () => {
    const canvas = editor(SPLIT, "Text");
    const main = role(canvas, "primary")!;
    let modified = 0;
    canvas.on("object:modified", () => modified++);
    main.on("modified", () => modified++);
    main.enterEditing();
    main.exitEditing();
    expect(main.text).toBe("Text");
    expect(role(canvas, "secondary")!.text).toBe("Text");
    expect(modified).toBe(0);
  });

  it("is still saved as the placeholder while the box is empty", () => {
    const canvas = editor(SPLIT, "Text");
    const main = role(canvas, "primary")!;
    main.enterEditing();
    const saved = canvas.toJSON().objects as unknown as { labelRole?: string; text?: string }[];
    expect(saved.find((o) => o.labelRole === "primary")?.text).toBe("Text");
    main.exitEditing();
  });

  it("uses the translated default words", () => {
    const main = role(editor(PLAIN_50x15, "Texto"), "primary")!;
    main.enterEditing();
    expect(main.text).toBe("");
    main.exitEditing();
    expect(main.text).toBe("Texto");
  });

  it("clears a text box the user added", () => {
    const canvas = editor(PLAIN_50x15, "Label");
    const added = new TextboxExt(DEFAULT_TEXT, { width: 100 });
    canvas.add(added);
    added.enterEditing();
    expect(added.text).toBe("");
    added.exitEditing();
    expect(added.text).toBe(DEFAULT_TEXT);
  });

  it("leaves real text alone", () => {
    const main = role(editor(PLAIN_50x15, "Text"), "primary")!;
    main.set({ text: "10x TE" });
    main.enterEditing();
    expect(main.text).toBe("10x TE");
    main.exitEditing();
  });

  it("survives the double tap that selects a word", () => {
    const main = role(editor(PLAIN_50x15, "Text"), "primary")!;
    main.enterEditing();
    expect(() => main.selectWord(0)).not.toThrow();
    type(main, "A");
    expect(main.text).toBe("A");
    main.exitEditing();
  });
});

describe("new label", () => {
  const texts = (canvas: CustomCanvas) => canvas.getObjects().map((o) => (o as TextboxExt).labelRole);

  it("leaves only the default text and date on a single label, on the same paper", () => {
    const canvas = editor(PLAIN_50x15, "Text");
    role(canvas, "primary")!.set({ text: "10x TE", fontFamily: "Barlow Semi Condensed" });
    canvas.add(new fabric.Rect({ width: 20, height: 20 }));
    canvas.resetToNewLabel();
    expect(texts(canvas).sort()).toEqual(["date", "primary"]);
    expect(role(canvas, "primary")!.text).toBe("Text");
    expect(role(canvas, "primary")!.fontFamily).toBe(OBJECT_DEFAULTS_TEXT.fontFamily);
    expect(canvas.getLabelProps().size).toEqual(PLAIN_50x15.size);
  });

  it("keeps the copy on a split label", () => {
    const canvas = editor(SPLIT, "Text");
    role(canvas, "primary")!.set({ text: "PBS" });
    canvas.layoutManagedText("all");
    canvas.resetToNewLabel();
    expect(texts(canvas).sort()).toEqual(["date", "primary", "secondary"]);
    expect(role(canvas, "secondary")!.text).toBe("Text");
  });

  it("ends editing, and the new text is a placeholder that clears", () => {
    const canvas = editor(PLAIN_50x15, "Text");
    const old = role(canvas, "primary")!;
    canvas.setActiveObject(old);
    old.enterEditing();
    type(old, "PBS");
    canvas.resetToNewLabel();
    expect(old.isEditing).toBe(false);
    const fresh = role(canvas, "primary")!;
    expect(fresh).not.toBe(old);
    fresh.enterEditing();
    expect(fresh.text).toBe("");
    fresh.exitEditing();
  });
});

describe("editor view", () => {
  it("shows the real gap between split pieces, empty, with no dashed line", () => {
    const canvas = editor(SPLIT, "Text");
    expect(canvas.editorWidth()).toBe(SPLIT.size.width);

    const out = canvas.toCanvasElement();
    const ctx = out.getContext("2d")!;
    const gapStart = SPLIT.splitSizeA!;
    const gapEnd = SPLIT.size.width - SPLIT.splitSizeB!;
    // Every pixel in the gap is see-through: no fill, no separator.
    const gap = ctx.getImageData(gapStart + 1, 0, gapEnd - gapStart - 2, SPLIT.size.height).data;
    let painted = 0;
    for (let i = 3; i < gap.length; i += 4) if (gap[i] !== 0) painted++;
    expect(painted).toBe(0);
  });

  it("moves objects from labels saved with the old collapsed gap back onto the real piece", async () => {
    const canvas = editor(SPLIT, "Text");
    const saved = canvas.toJSON();
    // Saved while the editor pulled the second piece 5 px closer.
    saved.objects.push({ ...new fabric.Rect({ left: 330, top: 40, width: 20, height: 20 }).toObject(), gapOffsetX: 5 });
    await canvas.loadFromJSON(saved);
    const rect = canvas.getObjects().find((o) => o instanceof fabric.Rect)! as fabric.Rect & { gapOffsetX?: number };
    expect(rect.left).toBe(335);
    expect(rect.gapOffsetX).toBeUndefined();
  });

  it("fits the label to the screen width, never above 100%", () => {
    const canvas = editor(SPLIT, "Text");
    canvas.fitToWidth(300);
    expect(canvas.getVirtualZoom()).toBeCloseTo(300 / SPLIT.size.width, 3);
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
