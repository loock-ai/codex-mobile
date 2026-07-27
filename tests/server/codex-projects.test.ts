import { describe, expect, it } from "vitest";
import { parseCodexProjectDirectories } from "../../server/codex-projects.js";

describe("Codex 项目目录", () => {
  it("按桌面端 project-order 读取本地项目，未排序项目在前并去重目录", () => {
    expect(parseCodexProjectDirectories(JSON.stringify({
      "local-projects": {
        one: {
          id: "one",
          name: "one",
          rootPaths: ["/Users/me/one", "/Users/me/shared"],
        },
        two: {
          id: "two",
          name: "two",
          rootPaths: ["/Users/me/two", "/Users/me/shared"],
        },
        unordered: {
          id: "unordered",
          rootPaths: ["/Users/me/unordered"],
        },
      },
      "project-order": ["remote", "two", "one"],
      "pinned-project-ids": ["one"],
      "remote-projects": [{ id: "remote", remotePath: "/workspace/remote" }],
    }))).toEqual([
      "/Users/me/unordered",
      "/Users/me/two",
      "/Users/me/shared",
      "/Users/me/one",
    ]);
  });

  it("忽略 remote-projects 和无效的本地项目记录", () => {
    expect(parseCodexProjectDirectories(JSON.stringify({
      "local-projects": {
        valid: { rootPaths: ["/Users/me/local"] },
        missingRoots: { name: "missing" },
        invalidRoots: { rootPaths: "not-an-array" },
        mixedRoots: { rootPaths: ["", 42, "/Users/me/second"] },
      },
      "remote-projects": {
        remote: { rootPaths: ["/workspace/remote"] },
      },
    }))).toEqual([
      "/Users/me/local",
      "/Users/me/second",
    ]);
  });

  it("没有 local-projects 时返回空列表", () => {
    expect(parseCodexProjectDirectories("{}")).toEqual([]);
  });
});
