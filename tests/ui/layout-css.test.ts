import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("悬浮状态布局", () => {
  it("待审批通知固定在 Header 下方且不再依赖页面底部", () => {
    const rule = styles.match(/\.backend-attention\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("position: fixed");
    expect(rule).toContain("top:");
    expect(rule).not.toContain("bottom:");
  });
});
