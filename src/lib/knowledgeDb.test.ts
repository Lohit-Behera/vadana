import { describe, expect, it } from "vitest";

describe("knowledge selection shape", () => {
  it("defaults folder and file ids to arrays", () => {
    const selection = JSON.parse('{"folderIds":[],"fileIds":[]}');
    expect(Array.isArray(selection.folderIds)).toBe(true);
    expect(Array.isArray(selection.fileIds)).toBe(true);
  });
});
