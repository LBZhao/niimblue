import type { LabelProps, LabelShape } from "$/types";

/** The label body, without its tail. */
export type LabelBounds = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
};

export type SplitPiece = {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: LabelShape;
};

export type TwoPieceLayout = {
  axis: "vertical" | "horizontal";
  pieces: [SplitPiece, SplitPiece];
  gap: number;
  gapRect: { x: number; y: number; width: number; height: number };
  /** Reflection line for mirror flip. */
  flipAxis: number;
};

/** Label body inside a `width` x `height` canvas: the tail is cut off on its side. */
export const labelBounds = (props: LabelProps, width: number, height: number): LabelBounds => {
  let endX = width;
  let endY = height;
  let startX = 0;
  let startY = 0;
  const tail = props.tailLength ?? 0;

  if (props.tailPos === "right") {
    endX -= tail;
  } else if (props.tailPos === "bottom") {
    endY -= tail;
  } else if (props.tailPos === "left") {
    startX += tail;
  } else if (props.tailPos === "top") {
    startY += tail;
  }

  return { startX, startY, endX, endY, width: endX - startX, height: endY - startY };
};

/**
 * Two explicit pieces plus a gap: the first piece at the start, the second at the end.
 * Null for unsplit labels and for older labels without piece sizes (they use equal slices).
 */
export const twoPieceLayout = (props: LabelProps, bb: LabelBounds): TwoPieceLayout | null => {
  const split = props.split ?? "none";
  const sizeA = props.splitSizeA;
  const sizeB = props.splitSizeB;
  if ((split !== "vertical" && split !== "horizontal") || sizeA === undefined || sizeB === undefined) {
    return null;
  }
  if (!(sizeA > 0) || !(sizeB > 0)) {
    return null;
  }

  const shapeA = props.shapeA ?? props.shape ?? "rect";
  const shapeB = props.shapeB ?? props.shape ?? "rect";

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
};

/** The editor view: the second piece moved `shift` closer, leaving a smaller gap. */
export const collapseLayout = (layout: TwoPieceLayout, shift: number): TwoPieceLayout => {
  const [a, b] = layout.pieces;
  const shown = layout.gap - shift;
  if (layout.axis === "vertical") {
    return {
      ...layout,
      pieces: [a, { ...b, x: b.x - shift }],
      gap: shown,
      gapRect: { x: a.x + a.width, y: a.y, width: shown, height: a.height },
      flipAxis: a.x + a.width + shown / 2,
    };
  }
  return {
    ...layout,
    pieces: [a, { ...b, y: b.y - shift }],
    gap: shown,
    gapRect: { x: a.x, y: a.y + a.height, width: a.width, height: shown },
    flipAxis: a.y + a.height + shown / 2,
  };
};

/** Add one piece's outline to the current path. */
export const tracePiece = (ctx: CanvasRenderingContext2D, piece: SplitPiece, cornerRadius: number) => {
  const { x, y, width, height, shape } = piece;
  if (width <= 0 || height <= 0) return;

  if (shape === "circle") {
    const radius = Math.min(width, height) / 2;
    ctx.moveTo(x + width / 2 + radius, y + height / 2);
    ctx.arc(x + width / 2, y + height / 2, radius, 0, Math.PI * 2);
    return;
  }

  if (shape === "rounded_rect") {
    ctx.roundRect(x, y, width, height, Math.min(cornerRadius, width / 2, height / 2));
    return;
  }

  ctx.rect(x, y, width, height);
};
