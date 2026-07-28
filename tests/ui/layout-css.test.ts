import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("悬浮状态布局", () => {
  it("会话列表头部和机器选项使用同一个 sticky 容器", () => {
    const stickyRule =
      styles.match(/\.thread-list-sticky\s*\{([^}]*)\}/)?.[1] ?? "";
    const headerRule =
      styles.match(/\.list-header\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(stickyRule).toContain("position: sticky");
    expect(stickyRule).toContain("top: 0");
    expect(headerRule).not.toContain("position: fixed");
  });

  it("待审批通知固定在 Header 下方且不再依赖页面底部", () => {
    const rule = styles.match(/\.backend-attention\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("position: fixed");
    expect(rule).toContain("top:");
    expect(rule).not.toContain("bottom:");
  });

  it("对话详情顶部三个按钮使用紧凑尺寸", () => {
    const headerRule =
      styles.match(/(?:^|\n)\.conversation-header\s*\{([^}]*)\}/)?.[1] ?? "";
    const buttonRule =
      styles.match(
        /(?:^|\n)\.conversation-header \.round-button\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const iconRule =
      styles.match(
        /(?:^|\n)\.conversation-header \.round-button svg\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const contextRule =
      styles.match(/(?:^|\n)\.context-usage-button\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(headerRule).toContain("min-height: 60px");
    expect(buttonRule).toContain("width: 44px");
    expect(buttonRule).toContain("height: 44px");
    expect(iconRule).toContain("width: 23px");
    expect(iconRule).toContain("height: 23px");
    expect(contextRule).toContain("width: 44px");
    expect(contextRule).toContain("height: 44px");
  });

  it("对话详情右上角两个按钮共用无分割线胶囊容器", () => {
    const groupRule =
      styles.match(
        /(?:^|\n)\.conversation-header-actions\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const buttonRule =
      styles.match(
        /(?:^|\n)\.conversation-header-actions > button\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(groupRule).toContain("width: 88px");
    expect(groupRule).toContain("height: 44px");
    expect(groupRule).toContain("border-radius: 22px");
    expect(groupRule).toContain("background: #f7f7f7");
    expect(buttonRule).toContain("background: transparent");
    expect(buttonRule).not.toContain("border-left");
    expect(buttonRule).not.toContain("border-right");
  });

  it("自动化发送标签位于用户气泡上方并右对齐", () => {
    const labelRule =
      styles.match(
        /(?:^|\n)\.automation-message-label\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(labelRule).toContain("display: block");
    expect(labelRule).toContain("margin:");
    expect(labelRule).toContain("auto");
    expect(labelRule).toContain("color: #777");
    expect(labelRule).toContain("font-size: 12px");
  });

});
