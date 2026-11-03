import { modelsLibrary } from "@mmote/niimbluelib";

/** Model names known to the printer library, longest first so "B21_PRO" wins over "B21". */
const MODEL_NAMES = [...new Set(modelsLibrary.map((m) => m.model.toUpperCase()))].sort((a, b) => b.length - a.length);

/** NIIMBOT printers usually advertise as a letter, a number and "_", e.g. "M2_H-I112061648". */
const PRINTER_NAME_RX = /^[A-Z]\d+_/i;

/**
 * True when a Bluetooth name looks like a NIIMBOT printer: it matches the usual pattern,
 * or it starts with a known model name followed by "-", "_", a space or nothing ("B1-1234").
 */
export const isLikelyPrinterName = (name?: string | null): boolean => {
  if (!name) return false;
  if (PRINTER_NAME_RX.test(name)) return true;
  const upper = name.toUpperCase();
  return MODEL_NAMES.some((model) => {
    if (!upper.startsWith(model)) return false;
    const next = upper.charAt(model.length);
    return next === "" || next === "-" || next === "_" || next === " ";
  });
};
