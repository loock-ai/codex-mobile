import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("侧边栏刷新视觉", () => {
  it("全部来源信息右对齐且全部 Tab 使用紧凑尺寸", () => {
    const sourceRule =
      styles.match(/(?:^|\n)\.thread-source\s*\{([^}]*)\}/)?.[1] ?? "";
    const allTabRule =
      styles.match(/(?:^|\n)\.backend-pill\.all-backends\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(sourceRule).toContain("text-align: right");
    expect(allTabRule).toContain("min-height: 38px");
    expect(allTabRule).toContain("font-size: 12px");
  });

  it("刷新按钮在刷新期间持续旋转", () => {
    const rule =
      styles.match(
        /(?:^|\n)\.list-header-actions \.round-button\.refreshing svg\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(rule).toContain("animation:");
  });
});
