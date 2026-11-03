import * as fabric from "fabric";
import {
  ExportedLabelTemplateSchema,
  LabelPresetSchema,
  UserFont,
  type ExportedLabelTemplate,
  type FabricJson,
  type LabelPreset,
  type LabelProps,
} from "$/types";
import {
  BUNDLED_FONTS,
  OBJECT_DEFAULTS,
  OBJECT_DEFAULTS_VECTOR,
  RECENT_THUMBNAIL_HEIGHT,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_QUALITY,
} from "$/defaults";
import { z } from "zod";
import { CustomCanvas } from "$/fabric-object/custom_canvas";
import { Capacitor } from "@capacitor/core";
import { CanvasUtils } from "$/utils/canvas_utils";
import { LocalStoragePersistence } from "./persistence";
import { bundledFontsReady, csvData, loadedFonts, recentPrints } from "$/stores";
import { get } from "svelte/store";

/** Folder under the phone's Documents where saved labels are written. */
const PHONE_LABELS_DIR = "NiimBlue";

export class FileUtils {
  static timestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  static timestampFloat(): number {
    return Date.now() / 1000;
  }

  /** Convert string to base64 string */
  static base64str(str: string): string {
    const bytes = new TextEncoder().encode(str);
    const binString = String.fromCodePoint(...bytes);
    return btoa(binString);
  }

  /** Convert object to base64 string */
  static base64obj(obj: unknown): string {
    const json: string = JSON.stringify(obj);
    return FileUtils.base64str(json);
  }

  /** Convert object to base64 string */
  static base64buf(buf: ArrayBuffer): Promise<string> {
    const blob = new Blob([buf]);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  static async decompressData(buf: BufferSource): Promise<ArrayBuffer> {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(buf);
    writer.close();
    return await new Response(ds.readable).arrayBuffer();
  }

  static async compressData(buf: BufferSource): Promise<ArrayBuffer> {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(buf);
    writer.close();
    return await new Response(cs.readable).arrayBuffer();
  }

  /** Convert base64 string to bytes */
  static base64toBytes(b64str: string): Uint8Array<ArrayBuffer> {
    const binaryString = atob(b64str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.codePointAt(i)!;
    }
    return bytes;
  }

  static async blobToDataUrl(file: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (readerEvt: ProgressEvent<FileReader>) => {
        if (readerEvt?.target?.result) {
          resolve(readerEvt.target.result as string);
        }
      };
      reader.onerror = (readerEvt: ProgressEvent<FileReader>) => {
        console.error(readerEvt);
        reject(new Error("File read error"));
      };
    });
  }

  static async downloadBase64Web(filename: string, mime: string, base64Data: string) {
    const byteChars = atob(base64Data);
    const byteNumbers = new Array(byteChars.length);

    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }

    const arr = new Uint8Array(byteNumbers);
    const blob = new Blob([arr], { type: mime });

    const a = document.createElement("a");
    a.download = filename;
    a.href = URL.createObjectURL(blob);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 10_000);
  }

  static async downloadBase64Capacitor(filename: string, base64Data: string) {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    const result = await Filesystem.writeFile({
      data: base64Data,
      path: filename,
      directory: Directory.Cache,
    });

    await Share.share({
      title: filename,
      text: filename,
      url: result.uri,
    });
  }

  static async downloadBase64(filename: string, mime: string, base64Data: string) {
    if (Capacitor.getPlatform() !== "web") {
      FileUtils.downloadBase64Capacitor(filename, base64Data);
      return;
    }

    FileUtils.downloadBase64Web(filename, mime, base64Data);
  }

  static makeExportedLabel(
    canvas: fabric.Canvas,
    labelProps: LabelProps,
    includeCsv: boolean,
    thumbnailHeight: number = THUMBNAIL_HEIGHT,
  ): ExportedLabelTemplate {
    const thumbnailOptions = {
      width: canvas.width,
      height: canvas.height,
      left: 0,
      top: 0,
      multiplier: thumbnailHeight / (canvas.height || 1),
      quality: THUMBNAIL_QUALITY,
      format: "jpeg" as const,
    };
    const thumbnailBase64: string =
      canvas instanceof CustomCanvas
        ? canvas.withThumbnailBackground(() => canvas.toDataURL(thumbnailOptions))
        : canvas.toDataURL(thumbnailOptions);

    const tpl: ExportedLabelTemplate = {
      canvas: canvas.toJSON(),
      label: labelProps,
      thumbnailBase64,
      timestamp: FileUtils.timestamp(),
    };

    if (includeCsv) {
      tpl.csv = get(csvData);
    }

    tpl.id = LocalStoragePersistence.createUidForLabel(tpl);

    return tpl;
  }

  /** File name for a label: its title, or label_<timestamp> when untitled. */
  static labelFileName(label: ExportedLabelTemplate): string {
    const title = label.title?.trim().replaceAll(/[\\/:*?"<>|]/g, "_");
    return title ? `${title}.json` : `label_${label.timestamp ?? FileUtils.timestamp()}.json`;
  }

  /**
   * Write the label to Documents/NiimBlue on the phone, so it survives reinstalling the app.
   * The same title overwrites its file. Returns the path shown to the user, or null on the web.
   */
  static async saveLabelToPhone(label: ExportedLabelTemplate): Promise<string | null> {
    if (Capacitor.getPlatform() === "web") return null;
    const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
    const parsed = ExportedLabelTemplateSchema.omit({ id: true }).parse(label);
    const data = JSON.stringify(parsed);
    const write = (name: string) =>
      Filesystem.writeFile({
        path: `${PHONE_LABELS_DIR}/${name}`,
        data,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });

    let name = FileUtils.labelFileName(parsed);
    try {
      await write(name);
    } catch {
      // Android only lets an app overwrite files it created, e.g. not ones left by an older install.
      name = name.replace(/\.json$/, `_${FileUtils.timestamp()}.json`);
      await write(name);
    }
    return `Documents/${PHONE_LABELS_DIR}/${name}`;
  }

  /** Convert label template to JSON and download it */
  static saveLabelAsJson(label: ExportedLabelTemplate) {
    const parsed = ExportedLabelTemplateSchema.omit({ id: true }).parse(label);
    const timestamp = label.timestamp ?? FileUtils.timestamp();
    let filename = `label_${timestamp}.json`;

    if (parsed.title && parsed.title.trim().length > 0) {
      filename = `${parsed.title}.json`;
    }

    FileUtils.downloadBase64(filename, "application/json", FileUtils.base64obj(parsed));
  }

  /** Convert canvas to PNG and download it */
  static saveCanvasAsPng(canvas: fabric.Canvas) {
    const timestamp = FileUtils.timestamp();

    const url = canvas.toDataURL({
      width: canvas.width,
      height: canvas.height,
      left: 0,
      top: 0,
      format: "png",
      multiplier: 1,
    });

    FileUtils.downloadBase64(`label_${timestamp}.png`, "image/png", url.split("base64,")[1]);
  }

  /** Convert label template to JSON and download it */
  static saveLabelPresetsAsJson(presets: LabelPreset[]) {
    const parsed = z.array(LabelPresetSchema).parse(presets);
    FileUtils.downloadBase64(`presets_${FileUtils.timestamp()}.json`, "application/json", FileUtils.base64obj(parsed));
  }

  /**
   * Open file picker and return file contents
   *
   * fixme: never ends if dialog closed
   *
   **/
  static async pickFileAsync(acceptExtension: string, multiple: boolean): Promise<FileList> {
    return new Promise((resolve) => {
      const input: HTMLInputElement = document.createElement("input");

      input.type = "file";
      input.multiple = multiple;

      if (acceptExtension !== "*") {
        input.accept = `.${acceptExtension}`;
      }

      input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files !== null && target.files.length > 0) {
          resolve(target.files);
        }
      };
      input.click();
    });
  }

  static async pickAndReadTextFile(acceptExtension: string, multiple: boolean): Promise<string[]> {
    const fileList = await FileUtils.pickFileAsync(acceptExtension, multiple);

    const result: string[] = [];

    for (const file of fileList) {
      const ext = file.name.split(".").pop();
      if (ext === acceptExtension) {
        const data = await file.text();
        result.push(data);
      } else {
        throw new Error(`Only ${acceptExtension} allowed`);
      }
    }

    return result;
  }

  static async pickAndReadSingleTextFile(acceptExtension: string): Promise<string> {
    const result = await FileUtils.pickAndReadTextFile(acceptExtension, false);
    if (result.length === 0) {
      throw new Error("No files processed");
    }
    return result[0];
  }

  /**
   * Open file picker and return file contents
   * */
  static async pickAndReadBinaryFile(acceptExtension: string): Promise<{ name: string; data: ArrayBuffer }> {
    const fileList = await FileUtils.pickFileAsync(acceptExtension, false);
    const file: File = fileList[0];
    const ext = file.name.split(".").pop();

    if (acceptExtension !== "*" && ext !== acceptExtension) {
      throw new Error(`Only ${acceptExtension} allowed`);
    }

    const data: ArrayBuffer = await file.arrayBuffer();
    return { name: file.name, data };
  }

  static async loadCanvasState(canvas: fabric.Canvas, state: FabricJson): Promise<void> {
    const deprecatedLines: fabric.Line[] = [];

    await canvas.loadFromJSON(state, (_, obj) => {
      if (obj instanceof fabric.FabricObject) {
        obj.set({ snapAngle: OBJECT_DEFAULTS.snapAngle });
        CanvasUtils.fixFabricObjectScale(obj);

        if (obj instanceof fabric.Line) {
          deprecatedLines.push(obj);
        }
      }
    });

    // convert deprecated Line to Polyline
    for (const line of deprecatedLines) {
      const poly = new fabric.Polyline(
        [
          { x: line.x1, y: line.y1 },
          { x: line.x2, y: line.y2 },
        ],
        {
          ...OBJECT_DEFAULTS_VECTOR,
          left: line.left,
          top: line.top,
          angle: line.angle,
          scaleX: line.scaleX,
          scaleY: line.scaleY,
          fill: line.fill,
          stroke: line.stroke,
          strokeWidth: line.strokeWidth,
        },
      );

      canvas.remove(line);
      canvas.add(poly);
    }

    if (canvas instanceof CustomCanvas) {
      canvas.virtualZoom(canvas.getVirtualZoom());
    }

    canvas.requestRenderAll();
  }

  static printImageUrls(sources: string[]) {
    const imgs = sources.map((src) => `<img src="${src}"/>`);

    const html = `
    <html>
      <head>
        <style>
          html, body {
            margin: 0;
            padding: 0;
          }
          img {
            display: block;
            width: 100vw;
            height: 100vh;
            image-rendering: pixelated;
            ${imgs.length > 1 ? "page-break-after: always;" : ""}
          }
        </style>
      </head>
      <body>
        ${imgs.join("\n")}
      </body>
    </html>
    `;

    const iframe = document.createElement("iframe");

    iframe.onload = () => {
      const iframeWindow = iframe.contentWindow!;
      iframeWindow.onafterprint = () => iframe.remove();
      iframeWindow.print();
    };

    iframe.style.display = "none";
    iframe.src = "about:blank";
    iframe.srcdoc = html;

    document.body.appendChild(iframe);
  }

  static async makeLabelUrl(label: ExportedLabelTemplate): Promise<string> {
    const labelStr = JSON.stringify({ ...label, thumbnailBase64: undefined });

    const encoder = new TextEncoder();
    const data = encoder.encode(labelStr);

    if (data.length > 2 * 1024 * 1024) {
      throw new Error("Label data size > 2MB");
    }

    const compressed = await FileUtils.compressData(data);
    const b64data = await FileUtils.base64buf(compressed);
    return `${location.protocol}//${location.host}/#load=${b64data}`;
  }

  static urlHashParamsToDict(): Record<string, string> {
    const anchorData = globalThis.location.hash.slice(1);

    if (!anchorData) {
      return {};
    }

    return anchorData.split("&").reduce((res: Record<string, string>, item: string) => {
      const firstEqualsIndex = item.indexOf("=");

      if (firstEqualsIndex === -1) {
        // Handle case without value (e.g., "key" without "=value")
        res[item] = "";
      } else {
        const key = item.slice(0, firstEqualsIndex);
        const value = item.slice(firstEqualsIndex + 1);
        res[key] = value;
      }

      return res;
    }, {});
  }

  static async readLabelFromUrl(): Promise<ExportedLabelTemplate | null> {
    const params = FileUtils.urlHashParamsToDict();

    if ("uload" in params) {
      const b64data: string = params["uload"];
      const jsonBytes = FileUtils.base64toBytes(b64data);
      const jsonStr = new TextDecoder().decode(jsonBytes);
      const labelObj = JSON.parse(jsonStr);
      return ExportedLabelTemplateSchema.parse(labelObj);
    }

    if (!("load" in params)) {
      return null;
    }

    const b64data: string = params["load"];
    const bytes = FileUtils.base64toBytes(b64data);
    const decompressed = await FileUtils.decompressData(bytes);
    const decoder = new TextDecoder();

    const decoded = decoder.decode(decompressed);
    const labelObj = JSON.parse(decoded);
    return ExportedLabelTemplateSchema.parse(labelObj);
  }

  /**
   * Canvas text does not trigger @font-face downloads, and Fabric caches glyph widths per family.
   * Load every weight up front, then drop widths measured with a fallback font.
   */
  static async loadBundledFonts() {
    const weights = [400, 500, 600, 700];
    await Promise.allSettled(
      BUNDLED_FONTS.flatMap((family) => weights.map((w) => document.fonts.load(`${w} 16px "${family}"`))),
    );
    BUNDLED_FONTS.forEach((family) => fabric.cache.clearFontCache(family));
    bundledFontsReady.set(true);
  }

  /** Draw a fresh thumbnail for a stored label, the same way saving does. */
  static async renderThumbnail(
    tpl: ExportedLabelTemplate,
    height: number = THUMBNAIL_HEIGHT,
  ): Promise<string | undefined> {
    const canvas = new CustomCanvas(undefined, { width: tpl.label.size.width, height: tpl.label.size.height });
    try {
      canvas.suspendManagedLayout = true;
      canvas.setLabelProps(tpl.label);
      await FileUtils.loadCanvasState(canvas, tpl.canvas);
      canvas.suspendManagedLayout = false;
      canvas.layoutManagedText();
      return FileUtils.makeExportedLabel(canvas, tpl.label, false, height).thumbnailBase64;
    } finally {
      canvas.dispose();
    }
  }

  /**
   * Thumbnails saved before the scaled-export fix are missing the label shapes.
   * Redraw saved labels once, and recent prints once at their larger size.
   */
  static async refreshStoredThumbnails() {
    // v3: saved labels moved to 96 px thumbnails for the two-column grid.
    const savedFlag = "thumbnails_v3";
    const recentFlag = "recent_thumbnails_v3";

    const savedKeys = localStorage.getItem(savedFlag) === null ? Object.keys(localStorage) : [];
    for (const key of savedKeys.filter((k) => k.startsWith("saved_label"))) {
      try {
        const item = LocalStoragePersistence.loadAndValidateObject(key, ExportedLabelTemplateSchema);
        if (item === null) continue;
        item.thumbnailBase64 = await FileUtils.renderThumbnail(item);
        LocalStoragePersistence.validateAndSaveObject(key, item, ExportedLabelTemplateSchema.omit({ id: true }));
      } catch (e) {
        console.error(`Thumbnail refresh failed for ${key}:`, e);
      }
    }

    localStorage.setItem(savedFlag, "1");
    if (localStorage.getItem(recentFlag) !== null) return;

    const recent = get(recentPrints);
    const redrawn: ExportedLabelTemplate[] = [];
    for (const item of recent) {
      try {
        redrawn.push({ ...item, thumbnailBase64: await FileUtils.renderThumbnail(item, RECENT_THUMBNAIL_HEIGHT) });
      } catch (e) {
        console.error("Thumbnail refresh failed for a recent print:", e);
        redrawn.push(item);
      }
    }
    if (recent.length > 0) recentPrints.set(redrawn);
    localStorage.setItem(recentFlag, "1");
  }

  static async loadFonts(fontsToLoad: UserFont[]) {
    const loadedList = get(loadedFonts);

    for (const font of fontsToLoad) {
      if (loadedList.some((e) => e.family === font.family)) {
        continue;
      }

      const bytes = FileUtils.base64toBytes(font.gzippedDataB64);
      const decompressed = await FileUtils.decompressData(bytes);
      const b64 = await FileUtils.base64buf(decompressed);

      const fontFace = new FontFace(font.family, `url(data:${font.mimeType};base64,${b64})`);

      try {
        const loaded = await fontFace.load();
        loadedList.push(loaded);
        document.fonts.add(loaded);
      } catch (e) {
        console.error(`Failed to load font ${font.family}:`, e);
      }
    }

    // remove font that not exist anymore
    for (let i = loadedList.length - 1; i >= 0; i--) {
      const loadedFont = loadedList[i];

      if (!fontsToLoad.some((e) => e.family === loadedFont.family)) {
        document.fonts.delete(loadedFont);
        loadedList.splice(i, 1);
      }
    }

    loadedFonts.set(loadedList);
  }
}
