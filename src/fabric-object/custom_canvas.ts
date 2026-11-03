import * as fabric from "fabric";
import { DEFAULT_LABEL_PROPS, GRID_SIZE, OBJECT_DEFAULTS_TEXT } from "$/defaults";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import type { LabelProps, LabelShape } from "$/types";
import {
  firstLine,
  newlineCount,
  placeCircleText,
  placeFittedText,
  secondaryText,
  dateStamp,
  sizeDateText,
  type TextArea,
} from "$/utils/label_text_layout";

type LabelBounds = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
};
type FoldSegment = { start: number; end: number };
type FoldInfo = {
  axis: "vertical" | "horizontal" | "none";
  points: number[];
  segments: FoldSegment[];
  /** Reflection line for mirror flip. Copy anchors stay in `points`. */
  flipAxis?: number;
};
type SplitPiece = {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: LabelShape;
};
type TwoPieceLayout = {
  axis: "vertical" | "horizontal";
  pieces: [SplitPiece, SplitPiece];
  gap: number;
  gapRect: { x: number; y: number; width: number; height: number };
  flipAxis: number;
};
type MirrorInfo = { pos: fabric.Point; flip: boolean };
type GapObject = fabric.FabricObject & { gapOffsetX?: number; gapOffsetY?: number };

const extraGapProps = ["gapOffsetX", "gapOffsetY"];

const fontKey = (box: TextboxExt): string => `${box.fontFamily}|${box.fontWeight}|${box.fontStyle}`;
for (const prop of extraGapProps) {
  if (!fabric.FabricObject.customProperties.includes(prop)) {
    fabric.FabricObject.customProperties.push(prop);
  }
}

export class CustomCanvas extends fabric.Canvas {
  private labelProps: LabelProps = DEFAULT_LABEL_PROPS;
  private readonly SEPARATOR_LINE_WIDTH = 2;
  private readonly ROUND_RADIUS = 10;
  private readonly TAIL_WIDTH = 40;
  private readonly GRAY = "#CFCFCF";
  /** Backing paper around the pieces in thumbnails. Darker than GRAY so white pieces read clearly. */
  private readonly LINER = "#9E9E9E";
  private readonly MIRROR_GHOST_COLOR = "rgba(0, 0, 0, 0.3)";
  /** Blank rows kept above the fitted text and below the date, so printing never clips them. */
  private readonly EDGE_MARGIN = 3;
  /** Gap shown between split pieces in the editor. */
  private readonly EDITOR_GAP_MM = 1;
  /** Used for labels saved before dpmm was stored. */
  private readonly FALLBACK_DPMM = 8;
  private customBackground: boolean = true;
  private highlightMirror: boolean = true;
  private gridEnabled: boolean = false;
  private virtualZoomRatio: number = 1;
  /** Thumbnail capture draws the real gap. The editor collapses it to a dashed line. */
  private showPhysicalGap: boolean = false;
  private gapSyncPaused: boolean = false;
  /** Skip auto-fit while a saved label is replacing the canvas. */
  suspendManagedLayout = false;
  /** True while the fitter is moving managed text, so undo can ignore that removal. */
  layoutQuiet = false;
  /** Text used when the label has no primary box yet. */
  defaultLabelText = "Text";
  onZoomChange?: (zoom: number) => void;

  constructor(
    el?: string | HTMLCanvasElement,
    options?: fabric.TOptions<fabric.CanvasOptions>,
  ) {
    super(el, options);
    this.setupZoomAndPan();
    this.preserveObjectStacking = true;
    this.on("object:added", (e) => e.target && this.syncObjectGap(e.target));
    this.on("text:changed", (opt) => {
      const target = (opt as { target?: fabric.FabricObject }).target;
      this.onManagedTextChanged(target);
    });
    this.on("object:modified", (e) => {
      const target = e.target;
      if (!target) return;
      const objects = target instanceof fabric.ActiveSelection ? target.getObjects() : [target];
      objects.forEach((obj) => this.syncObjectGap(obj));
    });
  }

  private setupZoomAndPan() {
    this.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;

      if (event.ctrlKey) {
        event.preventDefault();

        const delta = event.deltaY;
        if (delta > 0) {
          this.virtualZoomOut();
        } else {
          this.virtualZoomIn();
        }
      }
    });

    // Capture on the drawing surface so a two-finger pinch is handled before
    // Fabric, including inside the Android WebView where the gesture never
    // bubbles to the canvas container.
    const surface = this.upperCanvasEl;

    let initialPinchDistance = 0;
    let initialZoom = 1;
    let lastMidPoint = { x: 0, y: 0 };

    surface.addEventListener(
        "touchstart",
        (e: TouchEvent) => {
          if (e.touches.length === 2) {
            e.preventDefault();
            e.stopPropagation();
            this.selection = false;
            this.discardActiveObject();

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            initialPinchDistance = Math.hypot(
                touch1.clientX - touch2.clientX,
                touch1.clientY - touch2.clientY,
            );
            initialZoom = this.getVirtualZoom();

            lastMidPoint = {
              x: (touch1.clientX + touch2.clientX) / 2,
              y: (touch1.clientY + touch2.clientY) / 2,
            };
          }
        },
        { passive: false, capture: true },
    );

    surface.addEventListener(
        "touchmove",
        (e: TouchEvent) => {
          if (e.touches.length === 2) {
            e.preventDefault();
            e.stopPropagation();

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // Zoom
            const currentPinchDistance = Math.hypot(
                touch1.clientX - touch2.clientX,
                touch1.clientY - touch2.clientY,
            );

            if (initialPinchDistance > 0) {
              const newZoom = currentPinchDistance / initialPinchDistance * initialZoom;
              if (Math.abs(newZoom - this.virtualZoomRatio) > 0.02) {
                if (isFinite(newZoom) && newZoom > 0) {
                  this.virtualZoom(newZoom);
                }
              }
            }

            // Pan
            const currentMidPoint = {
              x: (touch1.clientX + touch2.clientX) / 2,
              y: (touch1.clientY + touch2.clientY) / 2,
            };

            const dx = currentMidPoint.x - lastMidPoint.x;
            const dy = currentMidPoint.y - lastMidPoint.y;

            const wrapper = this.getElement().closest(".canvas-wrapper");
            if (wrapper) {
              wrapper.scrollLeft -= dx;
              wrapper.scrollTop -= dy;
            }
            lastMidPoint = currentMidPoint;
          }
        },
        { passive: false, capture: true },
    );

    const stopTouch = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialPinchDistance = 0;
      }
      if (e.touches.length === 0) {
        // If not adding this delay, it could happen that objects are selected after zooming/panning
        setTimeout(() => {
          this.selection = true;
        }, 10);
      }
    };
    surface.addEventListener("touchend", stopTouch, { capture: true });
    surface.addEventListener("touchcancel", stopTouch, { capture: true });
  }

  public virtualZoom(newZoom: number) {
    this.virtualZoomRatio = Math.min(Math.max(0.25, newZoom), 4);
    this.setDimensions(
      {
        width: this.virtualZoomRatio * this.getWidth() + "px",
        height: this.virtualZoomRatio * this.getHeight() + "px",
      },
      { cssOnly: true },
    );
    if (this.onZoomChange) {
      this.onZoomChange(this.virtualZoomRatio);
    }
    this.applyEditorClip();
  }

  /** Width the editor shows at 100%, after pulling the split pieces together. */
  public editorWidth(): number {
    const collapse = this.layoutGapShift();
    return this.getWidth() - (collapse?.axis === "vertical" ? collapse.gap : 0);
  }

  /** Zoom out so the label fits `available` CSS pixels. Never zooms in past 100%. */
  public fitToWidth(available: number) {
    if (!(available > 0)) return;
    this.virtualZoom(Math.min(1, available / this.editorWidth()));
  }

  /**
   * Draw the real gray gap, then restore the editor view.
   * Used for saved-label thumbnails.
   */
  withPhysicalGap<T>(draw: () => T): T {
    this.gapSyncPaused = true;
    this.showPhysicalGap = true;
    try {
      this.getObjects().forEach((obj) => this.expandObject(obj));
      this.layoutManagedTextForOutput();
      this.applyEditorClip();
      this.renderAll();
      return draw();
    } finally {
      this.showPhysicalGap = false;
      this.gapSyncPaused = false;
      this.syncEditorGap();
      this.layoutManagedText();
      this.renderAll();
    }
  }

  public virtualZoomIn() {
    this.virtualZoom(this.virtualZoomRatio * 1.05);
  }

  public virtualZoomOut() {
    this.virtualZoom(this.virtualZoomRatio * 0.95);
  }

  public getVirtualZoom(): number {
    return this.virtualZoomRatio;
  }

  public resetVirtualZoom() {
    this.virtualZoom(1);
  }

  setLabelProps(value: LabelProps) {
    this.labelProps = value;
    this.syncEditorGap();
    this.layoutManagedText();
    this.requestRenderAll();
  }

  setCustomBackground(value: boolean) {
    this.customBackground = value;
  }

  setHighlightMirror(value: boolean) {
    this.highlightMirror = value;
  }

  setGridEnabled(value: boolean) {
    this.gridEnabled = value;
    this.requestRenderAll();
  }

  /** Gap the editor keeps between the two pieces, in pixels. */
  private editorGap(physicalGap: number): number {
    const dpmm = this.labelProps.dpmm ?? this.FALLBACK_DPMM;
    return Math.min(physicalGap, Math.round(this.EDITOR_GAP_MM * dpmm));
  }

  /**
   * Editor view pulls the two pieces together, leaving a small gap. Thumbnails keep the real gap.
   * `gap` is how far the second piece moves, not the gap that is left.
   */
  private layoutGapShift(): { axis: "vertical" | "horizontal"; gap: number } | null {
    if (this.showPhysicalGap || !this.customBackground) return null;
    const layout = this.getTwoPieceLayout();
    if (!layout || !(layout.gap > 0)) return null;
    const shift = layout.gap - this.editorGap(layout.gap);
    if (!(shift > 0)) return null;
    return { axis: layout.axis, gap: shift };
  }

  private displayLayout(): TwoPieceLayout | null {
    const layout = this.getTwoPieceLayout();
    if (!layout) return null;
    const collapse = this.layoutGapShift();
    if (!collapse) return layout;
    const [a, b] = layout.pieces;
    const shown = layout.gap - collapse.gap;
    if (layout.axis === "vertical") {
      const nextB = { ...b, x: b.x - collapse.gap };
      return {
        ...layout,
        pieces: [a, nextB],
        gap: shown,
        gapRect: { x: a.x + a.width, y: a.y, width: shown, height: a.height },
        flipAxis: a.x + a.width + shown / 2,
      };
    }
    const nextB = { ...b, y: b.y - collapse.gap };
    return {
      ...layout,
      pieces: [a, nextB],
      gap: shown,
      gapRect: { x: a.x, y: a.y + a.height, width: a.width, height: shown },
      flipAxis: a.y + a.height + shown / 2,
    };
  }

  private tailDrawShift(): { x: number; y: number } {
    const collapse = this.layoutGapShift();
    if (!collapse) return { x: 0, y: 0 };
    if (collapse.axis === "vertical" && this.labelProps.tailPos === "right") return { x: -collapse.gap, y: 0 };
    if (collapse.axis === "horizontal" && this.labelProps.tailPos === "bottom") return { x: 0, y: -collapse.gap };
    return { x: 0, y: 0 };
  }

  private expandObject(obj: fabric.FabricObject) {
    const o = obj as GapObject;
    const dx = o.gapOffsetX ?? 0;
    const dy = o.gapOffsetY ?? 0;
    if (dx) obj.left = (obj.left ?? 0) + dx;
    if (dy) obj.top = (obj.top ?? 0) + dy;
    delete o.gapOffsetX;
    delete o.gapOffsetY;
    if (dx || dy) obj.setCoords();
  }

  private setGapOffset(obj: GapObject, axis: "vertical" | "horizontal", value: number) {
    if (axis === "vertical") {
      if (value) obj.gapOffsetX = value;
      else delete obj.gapOffsetX;
      delete obj.gapOffsetY;
    } else {
      if (value) obj.gapOffsetY = value;
      else delete obj.gapOffsetY;
      delete obj.gapOffsetX;
    }
  }

  /** Keep each object on its piece when the editor hides the gap. */
  private syncObjectGap(obj: fabric.FabricObject) {
    if (this.gapSyncPaused) return;
    const layout = this.getTwoPieceLayout();
    const collapse = this.layoutGapShift();
    if (!layout || !collapse) {
      this.expandObject(obj);
      return;
    }
    // The date is placed on the main piece. Collapsing the gap must not slide it.
    if (obj instanceof TextboxExt && obj.labelRole === "date") return;

    const o = obj as GapObject;
    if (collapse.axis === "vertical" && o.gapOffsetY) this.expandObject(obj);
    if (collapse.axis === "horizontal" && o.gapOffsetX) this.expandObject(obj);

    const prev = collapse.axis === "vertical" ? (o.gapOffsetX ?? 0) : (o.gapOffsetY ?? 0);
    const center = obj.getCenterPoint();
    const coord = collapse.axis === "vertical" ? center.x : center.y;
    const fullPieceB = collapse.axis === "vertical" ? layout.pieces[1].x : layout.pieces[1].y;

    if (prev === 0 && coord >= fullPieceB - 0.01) {
      if (collapse.axis === "vertical") obj.left = (obj.left ?? 0) - collapse.gap;
      else obj.top = (obj.top ?? 0) - collapse.gap;
      this.setGapOffset(o, collapse.axis, collapse.gap);
      obj.setCoords();
      return;
    }

    const onSecondPiece = coord >= fullPieceB - collapse.gap - 0.01;
    const desired = onSecondPiece ? collapse.gap : 0;
    if (prev !== 0 && prev !== desired) {
      const delta = desired - prev;
      if (collapse.axis === "vertical") obj.left = (obj.left ?? 0) - delta;
      else obj.top = (obj.top ?? 0) - delta;
      obj.setCoords();
    }
    this.setGapOffset(o, collapse.axis, desired);
  }

  private syncEditorGap() {
    this.getObjects().forEach((obj) => this.syncObjectGap(obj));
    this.applyEditorClip();
  }

  /** Hide the empty strip left after the two pieces are pulled together. */
  private applyEditorClip() {
    const container = this.getElement()?.parentElement;
    if (!container) return;
    const zoom = this.virtualZoomRatio;
    const fullW = this.getWidth() * zoom;
    const fullH = this.getHeight() * zoom;
    const collapse = this.layoutGapShift();
    if (!collapse) {
      container.style.width = `${fullW}px`;
      container.style.height = `${fullH}px`;
      container.style.overflow = "";
      return;
    }
    const dw = collapse.axis === "vertical" ? collapse.gap * zoom : 0;
    const dh = collapse.axis === "horizontal" ? collapse.gap * zoom : 0;
    container.style.overflow = "hidden";
    container.style.width = `${Math.max(1, fullW - dw)}px`;
    container.style.height = `${Math.max(1, fullH - dh)}px`;
  }

  override centerObject(object: fabric.FabricObject) {
    const collapse = this.layoutGapShift();
    if (!collapse) {
      super.centerObject(object);
      return;
    }
    const bb = this.getLabelBounds();
    const endX = collapse.axis === "vertical" ? bb.endX - collapse.gap : bb.endX;
    const endY = collapse.axis === "horizontal" ? bb.endY - collapse.gap : bb.endY;
    object.setPositionByOrigin(new fabric.Point((bb.startX + endX) / 2, (bb.startY + endY) / 2), "center", "center");
    object.setCoords();
    this.syncObjectGap(object);
    this.renderOnAddRemove && this.requestRenderAll();
  }

  /**
   * Label size in canvas units. A scaled export (thumbnails) shrinks width/height and
   * zooms the viewport by the same factor, so divide the zoom back out.
   */
  private logicalSize(): { width: number; height: number } {
    const vpt = this.viewportTransform;
    return { width: (this.width ?? 1) / (vpt[0] || 1), height: (this.height ?? 1) / (vpt[3] || 1) };
  }

  /** Get label bounds without tail */
  getLabelBounds(): LabelBounds {
    let endX = this.logicalSize().width;
    let endY = this.logicalSize().height;
    let startX = 0;
    let startY = 0;

    if (this.labelProps.tailPos === "right") {
      endX -= this.labelProps.tailLength ?? 0;
    } else if (this.labelProps.tailPos === "bottom") {
      endY -= this.labelProps.tailLength ?? 0;
    } else if (this.labelProps.tailPos === "left") {
      startX += this.labelProps.tailLength ?? 0;
    } else if (this.labelProps.tailPos === "top") {
      startY += this.labelProps.tailLength ?? 0;
    }

    const width = endX - startX;
    const height = endY - startY;

    return { startX, startY, endX, endY, width, height };
  }

  /**
   * Two explicit pieces plus a gap.
   * Missing sizes keep the equal-slice layout used by older labels.
   */
  private getTwoPieceLayout(): TwoPieceLayout | null {
    const split = this.labelProps.split ?? "none";
    const sizeA = this.labelProps.splitSizeA;
    const sizeB = this.labelProps.splitSizeB;
    if ((split !== "vertical" && split !== "horizontal") || sizeA === undefined || sizeB === undefined) {
      return null;
    }
    if (!(sizeA > 0) || !(sizeB > 0)) {
      return null;
    }

    const bb = this.getLabelBounds();
    const shapeA = this.labelProps.shapeA ?? this.labelProps.shape ?? "rect";
    const shapeB = this.labelProps.shapeB ?? this.labelProps.shape ?? "rect";

    if (split === "vertical") {
      const gap = bb.width - sizeA - sizeB;
      if (gap < 0) return null;
      return {
        axis: "vertical",
        pieces: [
          { x: bb.startX, y: bb.startY, width: sizeA, height: bb.height, shape: shapeA },
          { x: bb.endX - sizeB, y: bb.startY, width: sizeB, height: bb.height, shape: shapeB },
        ],
        gap,
        gapRect: { x: bb.startX + sizeA, y: bb.startY, width: gap, height: bb.height },
        flipAxis: bb.startX + sizeA + gap / 2,
      };
    }

    const gap = bb.height - sizeA - sizeB;
    if (gap < 0) return null;
    return {
      axis: "horizontal",
      pieces: [
        { x: bb.startX, y: bb.startY, width: bb.width, height: sizeA, shape: shapeA },
        { x: bb.startX, y: bb.endY - sizeB, width: bb.width, height: sizeB, shape: shapeB },
      ],
      gap,
      gapRect: { x: bb.startX, y: bb.startY + sizeA, width: bb.width, height: gap },
      flipAxis: bb.startY + sizeA + gap / 2,
    };
  }

  private tracePiece(ctx: CanvasRenderingContext2D, piece: SplitPiece) {
    const { x, y, width, height, shape } = piece;
    if (width <= 0 || height <= 0) return;

    if (shape === "circle") {
      const radius = Math.min(width, height) / 2;
      ctx.moveTo(x + width / 2 + radius, y + height / 2);
      ctx.arc(x + width / 2, y + height / 2, radius, 0, Math.PI * 2);
      return;
    }

    if (shape === "rounded_rect") {
      const radius = Math.min(this.ROUND_RADIUS, width / 2, height / 2);
      ctx.roundRect(x, y, width, height, radius);
      return;
    }

    ctx.rect(x, y, width, height);
  }

  /** Get fold line position for splitted labels */
  getFoldInfo(): FoldInfo {
    const layout = this.displayLayout();
    if (layout) {
      const segments = layout.pieces.map((piece) => ({
        start: layout.axis === "vertical" ? piece.x : piece.y,
        end: layout.axis === "vertical" ? piece.x + piece.width : piece.y + piece.height,
      }));
      return {
        axis: layout.axis,
        points: [segments[1].start],
        segments,
        flipAxis: layout.flipAxis,
      };
    }

    const bb = this.getLabelBounds();
    const points: number[] = [];
    const segments: FoldSegment[] = [];
    const splitParts = this.labelProps.splitParts ?? 2;

    if (splitParts < 2) {
      return { axis: "none", points, segments };
    }

    if (this.labelProps.split === "horizontal") {
      const segmentHeight = bb.height / splitParts;
      let lastY: number = bb.startY;

      for (let i = 1; i < splitParts; i++) {
        const y =
          bb.startY + segmentHeight * i - this.SEPARATOR_LINE_WIDTH / 2 + 1;
        points.push(y);
        segments.push({ start: lastY, end: y });
        lastY = y;
      }

      segments.push({ start: lastY, end: bb.endY });

      return { axis: "horizontal", points, segments };
    } else if (this.labelProps.split === "vertical") {
      const segmentWidth = bb.width / splitParts;
      let lastX: number = bb.startX;

      for (let i = 1; i < splitParts; i++) {
        const x =
          bb.startX + segmentWidth * i - this.SEPARATOR_LINE_WIDTH / 2 + 1;
        points.push(x);
        segments.push({ start: lastX, end: x });
        lastX = x;
      }

      segments.push({ start: lastX, end: bb.endX });

      return { axis: "vertical", points, segments };
    }

    return { axis: "none", points, segments };
  }

  override _renderBackground(ctx: CanvasRenderingContext2D) {
    if (this.width === undefined || this.height === undefined) {
      return;
    }
    const { width, height } = this.logicalSize();
    const vpt = this.viewportTransform;

    ctx.save();
    // Same transform the objects are drawn with, so scaled exports line up.
    ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.fillStyle = "white";

    // Draw simple white background and exit
    if (!this.customBackground) {
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      return;
    }

    // Thumbnails are JPEG, which has no transparency. Paint the liner so the pieces stand out.
    if (this.showPhysicalGap) {
      ctx.fillStyle = this.LINER;
      ctx.fillRect(0, 0, width, height);
    }

    const layout = this.displayLayout();
    const physical = this.getTwoPieceLayout();

    // Disable further actions for circle labels, just render
    if (!physical && this.labelProps.shape === "circle") {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, height / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
      return;
    }

    let roundRadius = this.ROUND_RADIUS;
    const bb = this.getLabelBounds();
    const fold = this.getFoldInfo();

    if (this.labelProps.shape !== "rounded_rect") {
      roundRadius = 0;
    }

    // Draw tail. A right or bottom tail moves with the second piece.
    const tailShift = this.tailDrawShift();
    ctx.save();
    ctx.translate(tailShift.x, tailShift.y);
    ctx.fillStyle = this.GRAY;

    ctx.beginPath();
    if (
      this.labelProps.tailLength !== undefined &&
      this.labelProps.tailLength > 0
    ) {
      if (this.labelProps.tailPos === "right") {
        ctx.rect(
          bb.endX - roundRadius,
          bb.endY / 2 - this.TAIL_WIDTH / 2,
          width - bb.endX + roundRadius,
          this.TAIL_WIDTH,
        );
      } else if (this.labelProps.tailPos === "bottom") {
        ctx.rect(
          bb.endX / 2 - this.TAIL_WIDTH / 2,
          bb.endY - roundRadius,
          this.TAIL_WIDTH,
          height - bb.endY + roundRadius,
        );
      } else if (this.labelProps.tailPos === "left") {
        ctx.rect(
          0,
          bb.endY / 2 - this.TAIL_WIDTH / 2,
          bb.startX + roundRadius,
          this.TAIL_WIDTH,
        );
      } else if (this.labelProps.tailPos === "top") {
        ctx.rect(
          bb.endX / 2 - this.TAIL_WIDTH / 2,
          0,
          this.TAIL_WIDTH,
          bb.startY + roundRadius,
        );
      }
    }
    ctx.fill();
    ctx.restore();

    // Draw label(s)
    ctx.fillStyle = "white";

    ctx.beginPath();

    const splitParts = this.labelProps.splitParts ?? 2;

    if (layout) {
      layout.pieces.forEach((piece) => this.tracePiece(ctx, piece));
    } else if (this.labelProps.shape === "rounded_rect") {
      if (this.labelProps.split === "horizontal") {
        const segmentHeight = bb.height / splitParts;
        ctx.roundRect(
          bb.startX,
          bb.startY,
          bb.width,
          segmentHeight,
          roundRadius,
        ); // First part
        fold.points.forEach((y) =>
          ctx.roundRect(bb.startX, y, bb.width, segmentHeight, roundRadius),
        ); // Other parts
      } else if (this.labelProps.split === "vertical") {
        const segmentWidth = bb.width / splitParts;
        ctx.roundRect(
          bb.startX,
          bb.startY,
          segmentWidth,
          bb.height,
          roundRadius,
        ); // First part
        fold.points.forEach((x) =>
          ctx.roundRect(x, bb.startY, segmentWidth, bb.height, roundRadius),
        ); // Other parts
      } else {
        ctx.roundRect(0, 0, width, height, roundRadius);
      }
    } else {
      ctx.rect(bb.startX, bb.startY, bb.width, bb.height);
    }

    ctx.fill();

    // Thumbnails keep the gray gap. The editor uses a dashed line and no empty band.
    const showGrayGap = !!physical && physical.gap > 0 && !this.layoutGapShift();
    if (showGrayGap) {
      ctx.fillStyle = this.LINER;
      ctx.fillRect(physical.gapRect.x, physical.gapRect.y, physical.gapRect.width, physical.gapRect.height);
    }

    ctx.strokeStyle = this.GRAY;
    ctx.lineWidth = this.SEPARATOR_LINE_WIDTH;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();

    if (!showGrayGap) {
      const separatorInset = layout
        ? Math.min(
            ...layout.pieces.map((piece) =>
              piece.shape === "rounded_rect" ? Math.min(this.ROUND_RADIUS, piece.width / 2, piece.height / 2) : 0,
            ),
          )
        : roundRadius;
      // Split pieces: the line runs down the middle of the editor gap.
      const separators = layout
        ? [
            layout.axis === "vertical"
              ? layout.gapRect.x + layout.gapRect.width / 2
              : layout.gapRect.y + layout.gapRect.height / 2,
          ]
        : fold.points;

      if (fold.axis === "horizontal") {
        separators.forEach((x) => {
          ctx.moveTo(bb.startX + separatorInset, x);
          ctx.lineTo(bb.endX - separatorInset, x);
        });
      } else if (fold.axis === "vertical") {
        separators.forEach((y) => {
          ctx.moveTo(y, bb.startY + separatorInset);
          ctx.lineTo(y, bb.endY - separatorInset);
        });
      }
    }

    ctx.stroke();

    // Draw grid
    if (this.gridEnabled) {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(100, 100, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();

      const step = GRID_SIZE * 5;
      for (let x = bb.startX + step; x < bb.endX; x += step) {
        ctx.moveTo(x, bb.startY);
        ctx.lineTo(x, bb.endY);
      }
      for (let y = bb.startY + step; y < bb.endY; y += step) {
        ctx.moveTo(bb.startX, y);
        ctx.lineTo(bb.endX, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }
  override _renderObjects(
    ctx: CanvasRenderingContext2D,
    objects: fabric.FabricObject[],
  ) {
    super._renderObjects(ctx, objects);

    if (!this.highlightMirror || this.getActiveObjects().length > 1) {
      return;
    }

    ctx.save();

    objects.forEach((obj) => {
      const infos = this.getMirroredObjectCoords(obj);
      infos.forEach((info) => {
        const bbox = obj.getBoundingRect();
        ctx.fillStyle = this.MIRROR_GHOST_COLOR;
        ctx.fillRect(
          info.pos.x - bbox.width / 2,
          info.pos.y - bbox.height / 2,
          bbox.width,
          bbox.height,
        );
        ctx.restore();
      });
    });
    ctx.restore();
  }

  /**
   * Return new object positions (origin is center) if object needs mirroring
   **/
  getMirroredObjectCoords(obj: fabric.FabricObject): MirrorInfo[] {
    const fold = this.getFoldInfo();
    const result: MirrorInfo[] = [];

    if (
      fold.axis === "none" ||
      !(this.labelProps.mirror === "flip" || this.labelProps.mirror === "copy")
    ) {
      return result;
    }

    const bounds = this.getLabelBounds();

    if (fold.axis === "vertical") {
      if (this.labelProps.mirror === "copy") {
        fold.points.forEach((x) => {
          const pos = obj.getPointByOrigin("center", "center");
          pos.setX(x + (pos.x - bounds.startX));
          result.push({ pos, flip: false });
        });
      } else if (
        this.labelProps.mirror === "flip" &&
        fold.points.length === 1
      ) {
        // Half split only supported
        const axisX = fold.flipAxis ?? fold.points[0];
        const pos = obj.getPointByOrigin("center", "center");
        pos.setX(axisX + (axisX - pos.x));
        pos.setY(bounds.startY + bounds.endY - pos.y);
        result.push({ pos, flip: true });
      }
    } else if (fold.axis === "horizontal") {
      if (this.labelProps.mirror === "copy") {
        fold.points.forEach((y) => {
          const pos = obj.getPointByOrigin("center", "center");
          pos.setY(y + (pos.y - bounds.startY));
          result.push({ pos, flip: false });
        });
      } else if (
        this.labelProps.mirror === "flip" &&
        fold.points.length === 1
      ) {
        // Half split only supported
        const axisY = fold.flipAxis ?? fold.points[0];
        const pos = obj.getPointByOrigin("center", "center");
        pos.setY(axisY + (axisY - pos.y));
        pos.setX(bounds.startX + bounds.endX - pos.x);
        result.push({ pos, flip: true });
      }
    }

    return result;
  }

  /** Clone mirrored objects and add them to canvas */
  async createMirroredObjects() {
    const objects = this.getObjects();
    for (const obj of objects) {
      const infos = this.getMirroredObjectCoords(obj);

      for (const info of infos) {
        const newObj = await obj.clone();
        newObj.setPositionByOrigin(info.pos, "center", "center");
        if (info.flip) {
          newObj.centeredRotation = true;
          newObj.rotate((newObj.angle + 180) % 360);
        }
        this.add(newObj);
      }
    }
  }

  /** Centers object horizontally in the canvas or label part */
  override centerObjectH(object: fabric.FabricObject): void {
    if ((this.labelProps.split ?? "none") !== "none") {
      const pos = object.getPointByOrigin("center", "center");
      const bounds = this.getLabelBounds();
      const fold = this.getFoldInfo();
      let centerX = bounds.startX + bounds.width / 2;

      if (fold.axis !== "horizontal") {
        fold.segments.forEach((seg) => {
          if (pos.x >= seg.start && pos.x <= seg.end) {
            centerX = seg.start + (seg.end - seg.start) / 2;
          }
        });
      }
      pos.setX(centerX);

      object.setPositionByOrigin(pos, "center", "center");
      return;
    }

    super.centerObjectH(object);
  }

  /** Centers object vertically in the canvas or label part */
  override centerObjectV(object: fabric.FabricObject): void {
    if ((this.labelProps.split ?? "none") !== "none") {
      const pos = object.getPointByOrigin("center", "center");
      const bounds = this.getLabelBounds();
      const fold = this.getFoldInfo();
      let centerY = bounds.startY + bounds.height / 2;

      if (fold.axis !== "vertical") {
        fold.segments.forEach((seg) => {
          if (pos.y >= seg.start && pos.y <= seg.end) {
            centerY = seg.start + (seg.end - seg.start) / 2;
          }
        });
      }

      pos.setY(centerY);
      object.setPositionByOrigin(pos, "center", "center");
      return;
    }

    super.centerObjectV(object);
  }

  /**
   * Fit the primary text, the split copy, and the bottom date.
   * "primary" refits the main box and the copy. "secondary" refits only the copy.
   */
  layoutManagedText(mode: "all" | "primary" | "secondary" = "all") {
    if (!this.customBackground || this.showPhysicalGap || this.suspendManagedLayout || this.layoutQuiet) return;
    this.applyManagedLayout(mode);
  }

  /**
   * Place the date and text boxes on the real pieces, including the gap.
   * Print and thumbnails use this so collapsed editor coordinates are not what get drawn.
   */
  layoutManagedTextForOutput() {
    if (this.layoutQuiet || this.suspendManagedLayout) return;
    this.applyManagedLayout("all", true);
  }

  private applyManagedLayout(mode: "all" | "primary" | "secondary", physical = false) {
    this.layoutQuiet = true;
    try {
      const showDate = this.labelProps.date?.show !== false;
      if (mode === "all" && !showDate) this.removeDate();
      const date = !showDate ? undefined : mode === "all" ? this.ensureDate() : this.findRole("date");
      let dateHeight = date?.height ?? 0;
      if (mode === "all" && date) {
        const limit = this.managedFrames(0, physical).date;
        sizeDateText(date, this.dateStamp(), limit.labelHeight, limit.maxWidth, limit.maxHeight);
        dateHeight = date.height;
      }
      let frames = this.managedFrames(dateHeight, physical);
      if (mode === "all" && date && (date.height > frames.date.maxHeight || date.calcTextWidth() > frames.date.maxWidth)) {
        sizeDateText(date, this.dateStamp(), frames.date.labelHeight, frames.date.maxWidth, frames.date.maxHeight);
        frames = this.managedFrames(date.height, physical);
      }
      if (mode === "all" && date) this.placeDate(date, frames);
      if (mode === "all" || mode === "primary") this.fitPrimary(frames);
      if (mode === "all" || mode === "primary" || mode === "secondary") this.fitSecondary(frames);
      if (date) this.bringObjectToFront(date);
      for (const role of ["primary", "secondary"] as const) {
        const box = this.findRole(role);
        if (box) box.lastLayoutFont = fontKey(box);
      }
      this.requestRenderAll();
    } finally {
      this.layoutQuiet = false;
    }
  }

  private onManagedTextChanged(target?: fabric.FabricObject) {
    if (this.layoutQuiet || this.suspendManagedLayout || !this.customBackground || this.showPhysicalGap) return;
    if (!(target instanceof TextboxExt)) return;
    if (target.labelRole !== "primary" && target.labelRole !== "secondary") return;
    const prev = target.lastLayoutText ?? "";
    const next = target.text ?? "";
    if (next === prev) return;
    const linesChanged = newlineCount(next) !== newlineCount(prev);
    const firstChanged = firstLine(next) !== firstLine(prev);
    target.lastLayoutText = next;
    if (target.labelRole === "secondary") {
      if (linesChanged) this.layoutManagedText("secondary");
      return;
    }
    if (linesChanged) this.layoutManagedText("primary");
    else {
      this.lockPrimaryWrap(target, prev);
      if (firstChanged) this.layoutManagedText("secondary");
    }
  }

  /**
   * Call after a text control changed a managed box. A new main font carries over to the copy
   * and the date, then the label refits. Size-only edits are left alone.
   */
  syncManagedFont(target?: fabric.FabricObject) {
    if (!(target instanceof TextboxExt)) return;
    if (target.labelRole !== "primary" && target.labelRole !== "secondary") return;
    if (fontKey(target) === target.lastLayoutFont) return;
    if (target.labelRole === "primary") {
      const { fontFamily, fontWeight, fontStyle } = target;
      this.findRole("secondary")?.set({ fontFamily, fontWeight, fontStyle });
      this.findRole("date")?.set({ fontFamily });
      this.layoutManagedText("all");
    } else {
      this.layoutManagedText("secondary");
    }
  }

  private textboxes(): TextboxExt[] {
    return this.getObjects().filter((obj): obj is TextboxExt => obj instanceof TextboxExt);
  }

  private findRole(role: "primary" | "secondary" | "date"): TextboxExt | undefined {
    return this.textboxes().find((obj) => obj.labelRole === role);
  }

  private createRole(role: "primary" | "secondary" | "date", text: string): TextboxExt {
    // A new copy or date uses the main text's font.
    const primary = role === "primary" ? undefined : this.findRole("primary");
    const box = new TextboxExt(text, {
      ...OBJECT_DEFAULTS_TEXT,
      ...(primary ? { fontFamily: primary.fontFamily } : {}),
      labelRole: role,
    });
    this.add(box);
    return box;
  }

  /** Date text for this label, from its date settings. */
  dateStamp(): string {
    return dateStamp(this.labelProps.date);
  }

  private ensureDate(): TextboxExt {
    const existing = this.findRole("date");
    if (existing) return existing;
    return this.createRole("date", this.dateStamp());
  }

  /** The label has its date turned off. */
  private removeDate() {
    const date = this.findRole("date");
    if (!date) return;
    if (this.getActiveObject() === date) this.discardActiveObject();
    this.remove(date);
  }

  private managedFrames(dateHeight: number, physical = false): {
    primary: SplitPiece;
    secondary?: SplitPiece;
    primaryStopsForDate: boolean;
    textLimitY: number;
    date: {
      visualX: number;
      visualBottom: number;
      offsetX: number;
      offsetY: number;
      maxWidth: number;
      maxHeight: number;
      labelHeight: number;
    };
  } {
    const bounds = this.getLabelBounds();
    // Print and thumbnails must use the real gap. The editor frame has it removed.
    const display = physical ? this.getTwoPieceLayout() : this.displayLayout();
    const band = dateHeight + this.EDGE_MARGIN;
    if (!display) {
      return {
        primary: {
          x: bounds.startX,
          y: bounds.startY,
          width: bounds.width,
          height: bounds.height,
          shape: this.labelProps.shape ?? "rect",
        },
        primaryStopsForDate: true,
        textLimitY: bounds.endY - band,
        date: {
          visualX: bounds.startX + bounds.width / 2,
          visualBottom: bounds.endY,
          offsetX: 0,
          offsetY: 0,
          maxWidth: Math.max(1, bounds.width),
          maxHeight: Math.max(1, bounds.height - 2 * this.EDGE_MARGIN),
          labelHeight: bounds.height,
        },
      };
    }

    const [topOrLeft, bottomOrRight] = display.pieces;
    const mainBottom = topOrLeft.y + topOrLeft.height;
    return {
      primary: topOrLeft,
      secondary: bottomOrRight,
      primaryStopsForDate: true,
      textLimitY: mainBottom - band,
      date: {
        visualX: topOrLeft.x + topOrLeft.width / 2,
        visualBottom: mainBottom,
        offsetX: 0,
        offsetY: 0,
        maxWidth: Math.max(1, topOrLeft.width),
        maxHeight: Math.max(1, topOrLeft.height - 2 * this.EDGE_MARGIN),
        labelHeight: bounds.height,
      },
    };
  }

  private placeDate(
    date: TextboxExt,
    frames: {
      date: { visualX: number; visualBottom: number; offsetX: number; offsetY: number };
    },
  ) {
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
      new fabric.Point(frames.date.visualX, frames.date.visualBottom - this.EDGE_MARGIN),
      "center",
      "bottom",
    );
    const gap = date as GapObject;
    if (frames.date.offsetX) gap.gapOffsetX = frames.date.offsetX;
    else delete gap.gapOffsetX;
    if (frames.date.offsetY) gap.gapOffsetY = frames.date.offsetY;
    else delete gap.gapOffsetY;
    date.setCoords();
    date.lastLayoutText = date.text;
    date.dirty = true;
  }

  private areaAboveDate(piece: SplitPiece, stopAtDate: boolean, textLimitY: number): TextArea {
    const top = piece.y + this.EDGE_MARGIN;
    const pieceBottom = piece.y + piece.height - this.EDGE_MARGIN;
    const bottom = stopAtDate ? Math.min(pieceBottom, textLimitY) : pieceBottom;
    return {
      x: piece.x,
      y: top,
      width: Math.max(1, piece.width),
      height: Math.max(1, bottom - top),
    };
  }

  private fitPrimary(frames: { primary: SplitPiece; primaryStopsForDate: boolean; textLimitY: number }) {
    let box = this.findRole("primary");
    if (!box) {
      const candidate = this.textboxes().find((obj) => !obj.labelRole);
      if (candidate) {
        candidate.labelRole = "primary";
        box = candidate;
      }
    }
    if (!box) box = this.createRole("primary", this.defaultLabelText);
    placeFittedText(box, box.text ?? "", this.areaAboveDate(frames.primary, frames.primaryStopsForDate, frames.textLimitY));
    box.lastLayoutText = box.text;
    this.holdPiece(box, false);
  }

  private fitSecondary(frames: { secondary?: SplitPiece; textLimitY: number }) {
    const existing = this.findRole("secondary");
    if (!frames.secondary) {
      if (!existing) return;
      if (this.getActiveObject() === existing) this.discardActiveObject();
      this.remove(existing);
      return;
    }
    const { text: source, stacked } = secondaryText(this.findRole("primary")?.text ?? "");
    const box = existing ?? this.createRole("secondary", source);
    box.labelRole = "secondary";
    const pieceBottom = frames.secondary.y + frames.secondary.height;
    if (frames.secondary.shape === "circle") {
      placeCircleText(box, source, frames.secondary, pieceBottom - this.EDGE_MARGIN, stacked, frames.secondary.y + this.EDGE_MARGIN);
    } else {
      placeFittedText(box, source, this.areaAboveDate(frames.secondary, false, frames.textLimitY));
    }
    box.lastLayoutText = box.text;
    this.holdPiece(box, true);
  }

  /**
   * Keep the main box at the piece width so words wrap before Enter.
   * Typing keeps the font unless a wrapped word would run into the date.
   * Deleting refits, so the font can grow back.
   */
  private lockPrimaryWrap(box: TextboxExt, prevText: string) {
    const dateHeight = this.findRole("date")?.height ?? 0;
    const frames = this.managedFrames(dateHeight);
    const area = this.areaAboveDate(frames.primary, frames.primaryStopsForDate, frames.textLimitY);
    const pieceWidth = Math.max(1, area.width);
    const shorter = (box.text ?? "").length < prevText.length;
    this.layoutQuiet = true;
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
        this.holdPiece(box, false);
        return;
      }
      box.setPositionByOrigin(
        new fabric.Point(area.x + area.width / 2, area.y + area.height / 2),
        "center",
        "center",
      );
      box.setCoords();
      box.dirty = true;
      this.holdPiece(box, false);
    } finally {
      this.layoutQuiet = false;
    }
  }

  /** Remember which piece a fitted box belongs to without sliding it again. */
  private holdPiece(box: TextboxExt, onSecond: boolean) {
    const collapse = this.layoutGapShift();
    const gap = box as GapObject;
    if (!collapse) {
      delete gap.gapOffsetX;
      delete gap.gapOffsetY;
    } else {
      this.setGapOffset(gap, collapse.axis, onSecond ? collapse.gap : 0);
    }
    this.syncObjectGap(box);
  }
}
