import * as fabric from "fabric";
import { OBJECT_DEFAULTS_TEXT } from "$/defaults";
import { TextboxExt, type LabelTextRole } from "$/fabric-object/textbox-ext";
import type { CustomCanvas } from "$/fabric-object/custom_canvas";
import type { SplitPiece } from "$/fabric-object/split_layout";
import {
  dateStamp,
  firstLine,
  newlineCount,
  placeCircleText,
  placeFittedText,
  secondaryText,
  sizeDateText,
  type TextArea,
} from "$/utils/label_text_layout";

/** Blank rows kept above the fitted text and below the date, so printing never clips them. */
export const EDGE_MARGIN = 3;

type Frames = {
  primary: SplitPiece;
  secondary?: SplitPiece;
  /** Bottom of the main text area: the top of the date. */
  textLimitY: number;
  date: {
    centerX: number;
    bottom: number;
    maxWidth: number;
    maxHeight: number;
    labelHeight: number;
  };
};

const fontKey = (box: TextboxExt): string => `${box.fontFamily}|${box.fontWeight}|${box.fontStyle}`;

/**
 * The text the label fits by itself: the main text, its copy on the second piece of a split
 * label, and the date. The canvas decides when layout may run; this decides where things go.
 */
export class ManagedText {
  constructor(private readonly canvas: CustomCanvas) {}

  /** Date text for this label, from its date settings. */
  dateStamp(): string {
    return dateStamp(this.canvas.getLabelProps().date);
  }

  /**
   * Fit the main text, the copy and the date. "primary" refits the main box and the copy,
   * "secondary" only the copy. `physical` lays out on the real pieces (print, thumbnails).
   */
  apply(mode: "all" | "primary" | "secondary", physical = false) {
    const canvas = this.canvas;
    canvas.layoutQuiet = true;
    try {
      const showDate = canvas.getLabelProps().date?.show !== false;
      if (mode === "all" && !showDate) this.removeRole("date");
      const date = !showDate ? undefined : mode === "all" ? this.ensureDate() : this.findRole("date");
      let frames = this.frames(date?.height ?? 0, physical);
      if (mode === "all" && date) {
        // Size the date for the whole piece first, then again if the text band leaves it less room.
        const first = this.frames(0, physical).date;
        sizeDateText(date, this.dateStamp(), first.labelHeight, first.maxWidth, first.maxHeight);
        frames = this.frames(date.height, physical);
        if (date.height > frames.date.maxHeight || date.calcTextWidth() > frames.date.maxWidth) {
          sizeDateText(date, this.dateStamp(), frames.date.labelHeight, frames.date.maxWidth, frames.date.maxHeight);
          frames = this.frames(date.height, physical);
        }
        this.placeDate(date, frames);
      }
      if (mode === "all" || mode === "primary") this.fitPrimary(frames);
      this.fitSecondary(frames);
      if (date) canvas.bringObjectToFront(date);
      for (const role of ["primary", "secondary"] as const) {
        const box = this.findRole(role);
        if (box) box.lastLayoutFont = fontKey(box);
      }
      canvas.requestRenderAll();
    } finally {
      canvas.layoutQuiet = false;
    }
  }

  /** While typing: refit only what the change needs. */
  onTextChanged(target?: fabric.FabricObject) {
    if (!(target instanceof TextboxExt)) return;
    if (target.labelRole !== "primary" && target.labelRole !== "secondary") return;
    const prev = target.lastLayoutText ?? "";
    const next = target.text ?? "";
    if (next === prev) return;
    const linesChanged = newlineCount(next) !== newlineCount(prev);
    const firstChanged = firstLine(next) !== firstLine(prev);
    target.lastLayoutText = next;
    if (target.labelRole === "secondary") {
      if (linesChanged) this.canvas.layoutManagedText("secondary");
      return;
    }
    if (linesChanged) this.canvas.layoutManagedText("primary");
    else {
      this.lockPrimaryWrap(target, prev);
      if (firstChanged) this.canvas.layoutManagedText("secondary");
    }
  }

  /**
   * After a text control changed a managed box. A new main font carries over to the copy
   * and the date, then the label refits. Size-only edits are left alone.
   */
  syncFont(target?: fabric.FabricObject) {
    if (!(target instanceof TextboxExt)) return;
    if (target.labelRole !== "primary" && target.labelRole !== "secondary") return;
    if (fontKey(target) === target.lastLayoutFont) return;
    if (target.labelRole === "primary") {
      const { fontFamily, fontWeight, fontStyle } = target;
      this.findRole("secondary")?.set({ fontFamily, fontWeight, fontStyle });
      this.findRole("date")?.set({ fontFamily });
      this.canvas.layoutManagedText("all");
    } else {
      this.canvas.layoutManagedText("secondary");
    }
  }

  private textboxes(): TextboxExt[] {
    return this.canvas.getObjects().filter((obj): obj is TextboxExt => obj instanceof TextboxExt);
  }

  private findRole(role: LabelTextRole): TextboxExt | undefined {
    return this.textboxes().find((obj) => obj.labelRole === role);
  }

  private createRole(role: LabelTextRole, text: string): TextboxExt {
    // A new copy or date uses the main text's font.
    const primary = role === "primary" ? undefined : this.findRole("primary");
    const box = new TextboxExt(text, {
      ...OBJECT_DEFAULTS_TEXT,
      ...(primary ? { fontFamily: primary.fontFamily } : {}),
      labelRole: role,
    });
    this.canvas.add(box);
    return box;
  }

  private removeRole(role: LabelTextRole) {
    const box = this.findRole(role);
    if (!box) return;
    if (this.canvas.getActiveObject() === box) this.canvas.discardActiveObject();
    this.canvas.remove(box);
  }

  private ensureDate(): TextboxExt {
    return this.findRole("date") ?? this.createRole("date", this.dateStamp());
  }

  /** Where each box goes, given the date's height. */
  private frames(dateHeight: number, physical: boolean): Frames {
    const canvas = this.canvas;
    const bounds = canvas.getLabelBounds();
    // Print and thumbnails use the real gap. The editor view has it collapsed.
    const layout = physical ? canvas.getTwoPieceLayout() : canvas.displayLayout();
    const band = dateHeight + EDGE_MARGIN;
    const primary: SplitPiece = layout?.pieces[0] ?? {
      x: bounds.startX,
      y: bounds.startY,
      width: bounds.width,
      height: bounds.height,
      shape: canvas.getLabelProps().shape ?? "rect",
    };
    const mainBottom = primary.y + primary.height;
    return {
      primary,
      secondary: layout?.pieces[1],
      textLimitY: mainBottom - band,
      date: {
        centerX: primary.x + primary.width / 2,
        bottom: mainBottom,
        maxWidth: Math.max(1, primary.width),
        maxHeight: Math.max(1, primary.height - 2 * EDGE_MARGIN),
        labelHeight: bounds.height,
      },
    };
  }

  private placeDate(date: TextboxExt, frames: Frames) {
    date.set({
      originX: "center",
      originY: "bottom",
      angle: 0,
      editable: false,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      hoverCursor: "default",
    });
    date.setPositionByOrigin(
      new fabric.Point(frames.date.centerX, frames.date.bottom - EDGE_MARGIN),
      "center",
      "bottom",
    );
    // The date always belongs to the main piece.
    this.canvas.holdPiece(date, false);
    date.setCoords();
    date.lastLayoutText = date.text;
    date.dirty = true;
  }

  /** The piece minus the edge margins; the main text also stops at the date. */
  private textArea(piece: SplitPiece, stopAtDate: boolean, textLimitY: number): TextArea {
    const top = piece.y + EDGE_MARGIN;
    const pieceBottom = piece.y + piece.height - EDGE_MARGIN;
    const bottom = stopAtDate ? Math.min(pieceBottom, textLimitY) : pieceBottom;
    return { x: piece.x, y: top, width: Math.max(1, piece.width), height: Math.max(1, bottom - top) };
  }

  private fitPrimary(frames: Frames) {
    let box = this.findRole("primary");
    if (!box) {
      const candidate = this.textboxes().find((obj) => !obj.labelRole);
      if (candidate) {
        candidate.labelRole = "primary";
        box = candidate;
      }
    }
    if (!box) box = this.createRole("primary", this.canvas.defaultLabelText);
    placeFittedText(box, box.text ?? "", this.textArea(frames.primary, true, frames.textLimitY));
    box.lastLayoutText = box.text;
    this.canvas.holdPiece(box, false);
  }

  private fitSecondary(frames: Frames) {
    const piece = frames.secondary;
    if (!piece) {
      this.removeRole("secondary");
      return;
    }
    const { text: source, stacked } = secondaryText(this.findRole("primary")?.text ?? "");
    const box = this.findRole("secondary") ?? this.createRole("secondary", source);
    box.labelRole = "secondary";
    if (piece.shape === "circle") {
      const bottom = piece.y + piece.height - EDGE_MARGIN;
      placeCircleText(box, source, piece, bottom, stacked, piece.y + EDGE_MARGIN);
    } else {
      placeFittedText(box, source, this.textArea(piece, false, frames.textLimitY));
    }
    box.lastLayoutText = box.text;
    this.canvas.holdPiece(box, true);
  }

  /**
   * Keep the main box at the piece width so words wrap before Enter.
   * Typing keeps the font unless a wrapped word would run into the date.
   * Deleting refits, so the font can grow back.
   */
  private lockPrimaryWrap(box: TextboxExt, prevText: string) {
    const frames = this.frames(this.findRole("date")?.height ?? 0, false);
    const area = this.textArea(frames.primary, true, frames.textLimitY);
    const pieceWidth = Math.max(1, area.width);
    const shorter = (box.text ?? "").length < prevText.length;
    const canvas = this.canvas;
    canvas.layoutQuiet = true;
    try {
      box.dynamicMinWidth = 0;
      box.set({
        width: pieceWidth,
        splitByGrapheme: false,
        textAlign: "center",
        originX: "center",
        originY: "center",
        scaleX: 1,
        scaleY: 1,
        angle: 0,
      });
      box.dynamicMinWidth = 0;
      box.width = pieceWidth;
      box.initDimensions();
      const overflows = box.height > area.height + 0.5 || box.dynamicMinWidth > pieceWidth + 0.5;
      if (overflows || shorter) {
        placeFittedText(box, box.text ?? "", area);
        box.lastLayoutText = box.text;
      } else {
        box.setPositionByOrigin(
          new fabric.Point(area.x + area.width / 2, area.y + area.height / 2),
          "center",
          "center",
        );
        box.setCoords();
        box.dirty = true;
      }
      canvas.holdPiece(box, false);
    } finally {
      canvas.layoutQuiet = false;
    }
  }
}
