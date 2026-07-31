import { describe, expect, it } from "vitest";
import { formatBytes } from "./utils";

describe("formatBytes", () => {
  it("formats storage sizes used in document lists", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
