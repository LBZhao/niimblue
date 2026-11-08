import * as fabric from "fabric";

export type LabelTextRole = "primary" | "secondary" | "date";

/** Words in a text box the user just added. */
export const DEFAULT_TEXT = "Text";

interface UniqueTextboxExtProps {
  fontAutoSize: boolean;
  labelRole?: LabelTextRole;
}

const TEXTBOX_PROPS: Array<keyof UniqueTextboxExtProps> = ["fontAutoSize", "labelRole"];

const RTL_STRONG_CHAR_RE = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const LETTER_RE = /\p{Letter}/u;

const detectTextDirection = (text: string): "ltr" | "rtl" | undefined => {
  for (const char of text) {
    if (RTL_STRONG_CHAR_RE.test(char)) {
      return "rtl";
    }
    if (LETTER_RE.test(char)) {
      return "ltr";
    }
  }
};

export const textboxExtDefaultValues: Partial<fabric.TClassProperties<TextboxExt>> = {
  fontAutoSize: false,
};

export interface TextboxExtProps extends fabric.TextboxProps, UniqueTextboxExtProps {}
export interface SerializedTextboxExtProps extends fabric.SerializedTextboxProps, UniqueTextboxExtProps {}

export class TextboxExt<
    Props extends fabric.TOptions<TextboxExtProps> = Partial<TextboxExtProps>,
    SProps extends SerializedTextboxExtProps = SerializedTextboxExtProps,
    EventSpec extends fabric.ITextEvents = fabric.ITextEvents,
  >
  extends fabric.Textbox<Props, SProps, EventSpec>
  implements UniqueTextboxExtProps
{
  declare fontAutoSize: boolean;
  declare labelRole?: LabelTextRole;
  /** Text last placed by the label fitter. Not saved. */
  lastLayoutText?: string;
  /** Font (family, weight, style) the fitter last sized this box with. Not saved. */
  lastLayoutFont?: string;

  private widthBeforeEditing?: number;
  /** The placeholder taken out when editing started, kept while the box stays empty. */
  private clearedPlaceholder?: string;

  constructor(text: string, options?: Props) {
    super(text, options);
    Object.assign(this, textboxExtDefaultValues);
    this.setOptions(options);
    this.syncTextDirection();

    this.setControlsVisibility({
      mb: false,
      mt: false,
    });
  }

  private syncTextDirection(): boolean {
    const direction = detectTextDirection(this.text);
    const changed = direction !== undefined && direction !== this.direction;

    if (changed) {
      this.set({ direction });
    }

    if (this.hiddenTextarea) {
      this.hiddenTextarea.dir = this.direction;
    }

    return changed;
  }

  /** Set text and reduce fontSize until text fits to the given width */
  setAndShrinkText(text: string, maxWidth: number, maxLines?: number) {
    const linesLimit = maxLines ?? this._splitTextIntoLines(this.text).lines.length;

    let linesCount = this._splitTextIntoLines(text).lines.length;

    this.set({ text });
    this.syncTextDirection();

    while ((linesCount > linesLimit || this.width > maxWidth) && this.fontSize > 2) {
      this.fontSize -= 1;
      this.set({ text, width: maxWidth });
      linesCount = this._splitTextIntoLines(text).lines.length;
    }
  }

  /** Reduce fontSize until text fits to the given width */
  shrinkText(maxWidth: number, maxLines: number) {
    let linesCount = this._splitTextIntoLines(this.text).lines.length;

    while ((linesCount > maxLines || this.width > maxWidth) && this.fontSize > 2) {
      this.fontSize -= 1;
      this.set({ width: maxWidth });
      linesCount = this._splitTextIntoLines(this.text).lines.length;
    }
  }

  override initHiddenTextarea() {
    super.initHiddenTextarea();
    const textarea = this.hiddenTextarea;
    if (!textarea) return;

    // Android's keyboard treats this 1px field as single-line and uses Enter
    // to dismiss it. Ask for a newline key, and insert the break ourselves.
    textarea.enterKeyHint = "enter";

    const insertNewline = () => {
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? start;
      textarea.value = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
      const cursor = start + 1;
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak", data: "\n" }));
    };

    let handledEnter = false;
    const isPlainEnter = (e: KeyboardEvent) =>
      (e.key === "Enter" || e.keyCode === 13) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing;

    textarea.addEventListener(
      "keydown",
      (e) => {
        if (!isPlainEnter(e)) return;
        e.preventDefault();
        e.stopPropagation();
        insertNewline();
        handledEnter = true;
        queueMicrotask(() => {
          handledEnter = false;
        });
      },
      true,
    );

    textarea.addEventListener("beforeinput", (e) => {
      if (e.inputType !== "insertLineBreak") return;
      e.preventDefault();
      if (!handledEnter) insertNewline();
    });
  }

  override enterEditingImpl() {
    this.syncTextDirection();
    super.enterEditingImpl();
    this.syncTextDirection();
    this.widthBeforeEditing = this.width;
    if (this.isPlaceholder()) {
      this.clearedPlaceholder = this.text;
      this.replaceTextWhileEditing("");
    }
  }

  /** Empty again when editing ends: the placeholder comes back, and it never counted as an edit. */
  override exitEditing() {
    if (this.isEditing && this.clearedPlaceholder && !this.text) {
      this.replaceTextWhileEditing(this.clearedPlaceholder);
    }
    this.clearedPlaceholder = undefined;
    return super.exitEditing();
  }

  /** The default words of a new box. The main text uses the translated ones; "add text" uses DEFAULT_TEXT. */
  isPlaceholder(): boolean {
    if (this.labelRole === "secondary" || this.labelRole === "date") return false;
    const translated = (this.canvas as { defaultLabelText?: string } | undefined)?.defaultLabelText;
    return this.text === DEFAULT_TEXT || this.text === translated;
  }

  private replaceTextWhileEditing(text: string) {
    this.set({ text });
    this.initDimensions();
    if (this.hiddenTextarea) this.hiddenTextarea.value = text;
    this.selectionStart = text.length;
    this.selectionEnd = text.length;
    this._updateTextarea();
    this.canvas?.fire("text:changed", { target: this as unknown as fabric.IText });
  }

  override exitEditingImpl() {
    super.exitEditingImpl();
    this.widthBeforeEditing = undefined;
  }

  override updateFromTextArea(): void {
    super.updateFromTextArea();

    if (this.syncTextDirection()) {
      this.canvas?.requestRenderAll();
    }

    if (this.widthBeforeEditing !== undefined && this.fontAutoSize) {
      const lines = this.text.split("\n").length;
      this.shrinkText(this.widthBeforeEditing, lines);
    }
  }

  /**
   * Backport Fabric.js #10993 for RTL cursor hit-testing.
   * Fabric 7.4.0 compares RTL pointer coordinates in the wrong coordinate space.
   */
  override getSelectionStartFromPointer(e: fabric.TPointerEvent): number {
    if (this.direction !== "rtl") {
      return super.getSelectionStartFromPointer(e);
    }

    const mouseOffset = this.canvas!
      .getScenePoint(e)
      .transform(fabric.util.invertTransform(this.calcTransformMatrix()))
      .add(new fabric.Point(-this._getLeftOffset(), -this._getTopOffset()));

    let height = 0;
    let charIndex = 0;
    let lineIndex = 0;

    for (let i = 0; i < this._textLines.length; i++) {
      if (height <= mouseOffset.y) {
        height += this.getHeightOfLine(i);
        lineIndex = i;
        if (i > 0) {
          charIndex += this._textLines[i - 1].length + this.missingNewlineOffset(i - 1);
        }
      } else {
        break;
      }
    }

    const charLength = this._textLines[lineIndex].length;

    // _getLineLeftOffset also ensures the character bounds for the line are measured.
    const lineLeftOffset = this._getLineLeftOffset(lineIndex);
    const chars = this.__charBounds[lineIndex];
    const effectiveX = lineLeftOffset - mouseOffset.x;

    // Fabric renders the cursor from charBounds[charIndex].left. For shaped RTL
    // scripts (Arabic in particular), those measured positions can differ slightly
    // from a running sum of kernedWidth. Pick the nearest real cursor boundary so
    // click hit-testing and cursor rendering use the same geometry.
    let nearestCharIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let j = 0; j <= charLength; j++) {
      const cursorX = chars[j]?.left ?? 0;
      const distance = Math.abs(effectiveX - cursorX);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCharIndex = j;
      }
    }

    charIndex += nearestCharIndex;

    return Math.min(
      this.flipX ? charLength - charIndex : charIndex,
      this._text.length,
    );
  }

  override _renderSelection(
    ctx: CanvasRenderingContext2D,
    selection: { selectionStart: number; selectionEnd: number },
    boundaries: { left: number; top: number; leftOffset: number; topOffset: number },
  ): void {
    if (this.direction !== "rtl") {
      super._renderSelection(ctx, selection, boundaries);
      return;
    }

    const selectionStart = Math.min(selection.selectionStart, selection.selectionEnd);
    const selectionEnd = Math.max(selection.selectionStart, selection.selectionEnd);

    if (selectionStart === selectionEnd) {
      return;
    }

    const endLine = this.get2DCursorLocation(selectionEnd).lineIndex;
    const lineRanges = new Map<number, { minX: number; maxX: number; top: number }>();

    // Use the exact cursor geometry for every selected insertion boundary.
    // This keeps the blue selection rectangle aligned with the caret even when
    // Arabic shaping makes visual glyph widths differ from per-character widths.
    for (let index = selectionStart; index <= selectionEnd; index++) {
      const location = this.get2DCursorLocation(index);
      const cursor = this._getCursorBoundaries(index, true);
      const x = cursor.left + cursor.leftOffset;
      const top = cursor.top + cursor.topOffset;
      const range = lineRanges.get(location.lineIndex);

      if (range === undefined) {
        lineRanges.set(location.lineIndex, { minX: x, maxX: x, top });
      } else {
        range.minX = Math.min(range.minX, x);
        range.maxX = Math.max(range.maxX, x);
      }
    }

    for (const [lineIndex, range] of lineRanges) {
      let lineHeight = this.getHeightOfLine(lineIndex);
      let drawHeight = lineHeight;
      let extraTop = 0;

      if (this.lineHeight < 1 || (lineIndex === endLine && this.lineHeight > 1)) {
        lineHeight /= this.lineHeight;
        drawHeight = lineHeight;
      }

      if (this.inCompositionMode) {
        ctx.fillStyle = this.compositionColor || "black";
        drawHeight = 1;
        extraTop = lineHeight;
      } else {
        ctx.fillStyle = this.selectionColor;
      }

      ctx.fillRect(
        range.minX,
        range.top + extraTop,
        range.maxX - range.minX,
        drawHeight,
      );
    }
  }

  override toObject<T extends Omit<Props & fabric.TClassProperties<this>, keyof SProps>, K extends keyof T = never>(
    propertiesToInclude: K[] = [],
  ): Pick<T, K> & SProps {
    const object: Pick<T, K> & SProps = super.toObject([...propertiesToInclude, ...TEXTBOX_PROPS] as (keyof T)[]);
    // Previewing or saving before anything is typed still sees the placeholder, not a blank label.
    if (this.clearedPlaceholder && !this.text) (object as unknown as { text: string }).text = this.clearedPlaceholder;
    return object;
  }
}
