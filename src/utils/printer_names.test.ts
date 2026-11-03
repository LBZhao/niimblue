import { describe, expect, it } from "vitest";
import { isLikelyPrinterName } from "$/utils/printer_names";

describe("isLikelyPrinterName", () => {
  it("keeps NIIMBOT printer names", () => {
    for (const name of ["M2_H-I112061648", "B1-H123456", "D110-AB12", "B21_PRO-1", "D11_H-xyz", "T8S-1"]) {
      expect(isLikelyPrinterName(name), name).toBe(true);
    }
  });

  it("drops other nearby devices (from a real scan)", () => {
    const others = [
      "Desk 7972",
      "N010P",
      "Govee_H6076_3874",
      "LE-Bose Flex SE SoundLink",
      "S62 2F5C LE",
      "110057_6D60",
      "Y452020",
      "TUYA_",
      "[TV] Samsung Q60 Series (82)",
      "ET-3950 Series",
    ];
    for (const name of others) {
      expect(isLikelyPrinterName(name), name).toBe(false);
    }
  });

  it("drops devices without a name", () => {
    expect(isLikelyPrinterName(undefined)).toBe(false);
    expect(isLikelyPrinterName("")).toBe(false);
  });
});
