import * as fabric from "fabric";
import {
  DEFAULT_LABEL_PROPS,
  FALLBACK_DPMM,
  GRID_SIZE,
  LABEL_CORNER_RADIUS_MM,
} from "$/defaults";
import { ManagedText } from "$/fabric-object/managed_text";
import {
  labelBounds,
  tracePiece,
  twoPieceLayout,
  type LabelBounds,
  type TwoPieceLayout,
} from "$/fabric-object/split_layout";
import type { LabelProps } from "$/types";

type FoldSegment = { start: number; end: number };
type FoldInfo = {
  axis: "vertical" | "horizontal" | "none";
  points: number[];
  segments: FoldSegment[];
  /** Reflection line for mirror flip. Copy anchors stay in `points`. */
  flipAxis?: number;
};
type MirrorInfo = { pos: fabric.Point; flip: boolean };
type GapObject = fabric.FabricObject & { gapOffsetX?: number; gapOffsetY?: number };

const extraGapProps = ["gapOffsetX", "gapOffsetY"];

for (const prop of extraGapProps) {
  if (!fabric.FabricObject.customProperties.includes(prop)) {
    fabric.FabricObject.customProperties.push(prop);
  }
}

export class CustomCanvas extends fabric.Canvas {
  private labelProps: LabelProps = DEFAULT_LABEL_PROPS;
  private readonly SEPARATOR_LINE_WIDTH = 2;
  private readonly TAIL_WIDTH = 40;
  private readonly GRAY = "#CFCFCF";
  /** Backing paper around the pieces in thumbnails. Darker than GRAY so white pieces read clearly. */
  private readonly LINER = "#9E9E9E";
  private readonly MIRROR_GHOST_COLOR = "rgba(0, 0, 0, 0.3)";
  private customBackground: boolean = true;
  private highlightMirror: boolean = true;
  private gridEnabled: boolean = false;
  private virtualZoomRatio: number = 1;
  /** Thumbnail capture: paint the liner behind the pieces (JPEG has no transparency). */
  private capturingThumbnail: boolean = false;
  /** Skip auto-fit while a saved label is replacing the canvas. */
  suspendManagedLayout = false;
  /** True while the fitter is moving managed text, so undo can ignore that removal. */
  layoutQuiet = false;
  /** Text used when the label has no primary box yet. */
  defaultLabelText = "Text";
  private readonly managed = new ManagedText(this);
  onZoomChange?: (zoom: number) => void;

  constructor(
    el?: string | HTMLCanvasElement,
    options?: fabric.TOptions<fabric.CanvasOptions>,
  ) {
    super(el, options);
    this.setupZoomAndPan();
    this.preserveObjectStacking = true;
    this.on("object:added", (e) => e.target && this.expandLegacyGapOffset(e.target));
    this.on("text:changed", (opt) => {
      const target = (opt as { target?: fabric.FabricObject }).target;
      if (this.managedLayoutAllowed()) this.managed.onTextChanged(target);
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
  }

  /** Width the editor shows at 100%. */
  public editorWidth(): number {
    return this.getWidth();
  }

  /** Zoom out so the label fits `available` CSS pixels. Never zooms in past 100%. */
  public fitToWidth(available: number) {
    if (!(available > 0)) return;
    this.virtualZoom(Math.min(1, available / this.editorWidth()));
  }

  /** Draw with the liner painted behind the pieces. Used for saved-label thumbnails. */
  withThumbnailBackground<T>(draw: () => T): T {
    this.capturingThumbnail = true;
    try {
      this.renderAll();
      return draw();
    } finally {
      this.capturingThumbnail = false;
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

  /** Rounded corners are a fixed size in mm, so they look the same at any dpi. */
  private cornerRadius(): number {
    return Math.round(LABEL_CORNER_RADIUS_MM * (this.labelProps.dpmm ?? FALLBACK_DPMM));
  }

  /**
   * Labels saved while the editor collapsed the split gap stored how far objects on the second
   * piece were moved. Move them back once so they sit on the real piece.
   */
  private expandLegacyGapOffset(obj: fabric.FabricObject) {
    const o = obj as GapObject;
    const dx = o.gapOffsetX ?? 0;
    const dy = o.gapOffsetY ?? 0;
    delete o.gapOffsetX;
    delete o.gapOffsetY;
    if (!dx && !dy) return;
    obj.left = (obj.left ?? 0) + dx;
    obj.top = (obj.top ?? 0) + dy;
    obj.setCoords();
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
    const { width, height } = this.logicalSize();
    return labelBounds(this.labelProps, width, height);
  }

  /** The real pieces and gap, as printed. */
  getTwoPieceLayout(): TwoPieceLayout | null {
    return twoPieceLayout(this.labelProps, this.getLabelBounds());
  }

  /** Get fold line position for splitted labels */
  getFoldInfo(): FoldInfo {
    const layout = this.getTwoPieceLayout();
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
    if (this.capturingThumbnail) {
      ctx.fillStyle = this.LINER;
      ctx.fillRect(0, 0, width, height);
    }

    const layout = this.getTwoPieceLayout();

    // Disable further actions for circle labels, just render
    if (!layout && this.labelProps.shape === "circle") {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, height / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
      return;
    }

    let roundRadius = this.cornerRadius();
    const bb = this.getLabelBounds();
    const fold = this.getFoldInfo();

    if (this.labelProps.shape !== "rounded_rect") {
      roundRadius = 0;
    }

    // Draw tail
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

    // Draw label(s)
    ctx.fillStyle = "white";

    ctx.beginPath();

    const splitParts = this.labelProps.splitParts ?? 2;

    if (layout) {
      layout.pieces.forEach((piece) => tracePiece(ctx, piece, this.cornerRadius()));
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

    // Draw separator. Split pieces with a real gap need none: the gap shows between them.

    ctx.strokeStyle = this.GRAY;
    ctx.lineWidth = this.SEPARATOR_LINE_WIDTH;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();

    if (!layout) {
      if (fold.axis === "horizontal") {
        fold.points.forEach((x) => {
          ctx.moveTo(bb.startX + roundRadius, x);
          ctx.lineTo(bb.endX - roundRadius, x);
        });
      } else if (fold.axis === "vertical") {
        fold.points.forEach((y) => {
          ctx.moveTo(y, bb.startY + roundRadius);
          ctx.lineTo(y, bb.endY - roundRadius);
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

  /**
   * Snap the object's top-left corner to whole pixels (avoids half-pixel blur after centering).
   * Text is skipped: its glyphs can't sit on exact pixels anyway, and it should stay truly centered.
   */
  private snapToPixel(object: fabric.FabricObject): void {
    if (object instanceof fabric.FabricText) return;
    const pos = object.getPointByOrigin("left", "top");
    object.setPositionByOrigin(new fabric.Point(Math.round(pos.x), Math.round(pos.y)), "left", "top");
    object.setCoords();
  }

  override _centerObject(object: fabric.FabricObject, center: fabric.Point): void {
    super._centerObject(object, center);
    this.snapToPixel(object);
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
      this.snapToPixel(object);
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
      this.snapToPixel(object);
      return;
    }

    super.centerObjectV(object);
  }

  /** Layout runs in the editor only, and not while a label is loading or being laid out. */
  private managedLayoutAllowed(): boolean {
    return this.customBackground && !this.capturingThumbnail && !this.suspendManagedLayout && !this.layoutQuiet;
  }

  /** Start over on the same paper: only the default text, its copy on a split label, and the date. */
  resetToNewLabel() {
    this.discardActiveObject();
    this.remove(...this.getObjects());
    this.layoutManagedText("all");
  }

  /**
   * Fit the primary text, the split copy, and the bottom date.
   * "primary" refits the main box and the copy. "secondary" refits only the copy.
   */
  layoutManagedText(mode: "all" | "primary" | "secondary" = "all") {
    if (!this.managedLayoutAllowed()) return;
    this.managed.apply(mode);
  }

  /**
   * Place the date and text boxes on the real pieces, including the gap.
   * Print and thumbnails use this so collapsed editor coordinates are not what get drawn.
   */
  layoutManagedTextForOutput() {
    if (this.layoutQuiet || this.suspendManagedLayout) return;
    this.managed.apply("all");
  }

  /** Call after a text control changed a managed box; a new main font carries to the copy and date. */
  syncManagedFont(target?: fabric.FabricObject) {
    this.managed.syncFont(target);
  }

  /** Date text for this label, from its date settings. */
  dateStamp(): string {
    return this.managed.dateStamp();
  }

  getLabelProps(): LabelProps {
    return this.labelProps;
  }


}
