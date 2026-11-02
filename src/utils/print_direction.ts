import type { PrintDirection, PrinterModelMeta } from "@mmote/niimbluelib";

/** NIIMBOT M2 / M2_H feeds from the top. "left" rotates the image 90 degrees. */
export function isM2Printer(model?: string, deviceName?: string): boolean {
  const modelName = (model ?? "").toUpperCase();
  const name = (deviceName ?? "").toUpperCase();
  return modelName.startsWith("M2") || /(^|[^A-Z0-9])M2([^A-Z0-9]|$)/.test(name);
}

export function printDirectionForPrinter(
  labelDirection: PrintDirection,
  meta?: PrinterModelMeta,
  deviceName?: string,
): PrintDirection {
  if (isM2Printer(meta?.model, deviceName)) {
    return "top";
  }
  return labelDirection;
}
