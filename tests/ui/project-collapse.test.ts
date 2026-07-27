import { beforeEach, describe, expect, it } from "vitest";
import {
  projectCollapseKey,
  readCollapsedProjectKeys,
  writeCollapsedProjectKeys,
} from "../../src/features/threads/project-collapse";

describe("项目折叠缓存", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("按照机器和目录生成稳定的项目键", () => {
    expect(projectCollapseKey("mini", "/tmp/project")).toBe(
      "mini:/tmp/project",
    );
  });

  it("写入并恢复折叠项目集合", () => {
    writeCollapsedProjectKeys(
      window.localStorage,
      new Set(["mini:/tmp/a", "mac:/tmp/b"]),
    );

    expect(readCollapsedProjectKeys(window.localStorage)).toEqual(
      new Set(["mini:/tmp/a", "mac:/tmp/b"]),
    );
  });

  it("忽略损坏或非字符串数组缓存", () => {
    window.localStorage.setItem(
      "codex-mobile:collapsed-projects",
      "{\"bad\":true}",
    );
    expect(readCollapsedProjectKeys(window.localStorage)).toEqual(new Set());

    window.localStorage.setItem(
      "codex-mobile:collapsed-projects",
      "[\"mini:/tmp/a\",2]",
    );
    expect(readCollapsedProjectKeys(window.localStorage)).toEqual(new Set());
  });
});
