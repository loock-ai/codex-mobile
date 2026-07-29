import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("侧边栏刷新视觉", () => {
  it("全部来源信息右对齐且全部与机器 Tab 使用相同紧凑尺寸", () => {
    const sourceRule =
      styles.match(/(?:^|\n)\.thread-source\s*\{([^}]*)\}/)?.[1] ?? "";
    const machineTabRule =
      styles.match(/(?:^|\n)\.backend-pill\s*\{([^}]*)\}/)?.[1] ?? "";
    const allTabRule =
      styles.match(/(?:^|\n)\.backend-pill\.all-backends\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(sourceRule).toContain("text-align: right");
    expect(machineTabRule).toContain("height: 36px");
    expect(machineTabRule).toContain("border-radius: 18px");
    expect(machineTabRule).toContain("font-size: 12px");
    expect(allTabRule).toContain("height: 36px");
    expect(allTabRule).toContain("border-radius: 18px");
    expect(allTabRule).toContain("font-size: 12px");
  });

  it("机器 Tab 选中态使用浅灰背景而不是黑色反白", () => {
    const selectedRule =
      styles.match(
        /(?:^|\n)\.backend-pill\[aria-pressed="true"\]\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(selectedRule).toContain("background: #c6c6c6");
    expect(selectedRule).toContain("color: #111");
    expect(selectedRule).not.toContain("background: #111");
    expect(selectedRule).not.toContain("color: #fff");
    expect(selectedRule).not.toContain("box-shadow");
  });

  it("刷新按钮在刷新期间持续旋转", () => {
    const rule =
      styles.match(
        /(?:^|\n)\.list-header-actions \.round-button\.refreshing svg\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(rule).toContain("animation:");
  });
});
