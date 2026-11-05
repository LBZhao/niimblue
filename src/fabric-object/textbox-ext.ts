import * as fabric from "fabric";

export type LabelTextRole = "primary" | "secondary" | "date";

/** Words in a text box the user just added. */
export const DEFAULT_TEXT = "Text";

interface UniqueTextboxExtProps {
  fontAutoSize: boolean;
  labelRole?: LabelTextRole;
}

const TEXTBOX_PROPS: Array<keyof UniqueTextboxExtProps> = ["fontAutoSize", "labelRole"];

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

    this.setControlsVisibility({
      mb: false,
      mt: false,
    });
  }

  /** Set text and reduce fontSize until text fits to the given width */
  setAndShrinkText(text: string, maxWidth: number, maxLines?: number) {
    const linesLimit = maxLines ?? this._splitTextIntoLines(this.text).lines.length;

    let linesCount = this._splitTextIntoLines(text).lines.length;

    this.set({ text });

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
    super.enterEditingImpl();
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

    if (this.widthBeforeEditing !== undefined && this.fontAutoSize) {
      const lines = this.text.split("\n").length;
      this.shrinkText(this.widthBeforeEditing, lines);
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
