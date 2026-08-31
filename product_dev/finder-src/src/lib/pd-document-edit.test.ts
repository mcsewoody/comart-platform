import { describe, expect, it } from "vitest";
import { documentListText, parseDocumentList } from "./pd-document-edit";

describe("Product Finder document editing", () => {
  it("accepts Chinese and English separators and removes duplicates", () => {
    expect(parseDocumentList("Qi, 三合一、Qi\nWatch"))
      .toEqual(["Qi", "三合一", "Watch"]);
  });

  it("renders a compact editable list", () => {
    expect(documentListText(["Qi", "三合一"])).toBe("Qi、三合一");
  });
});
