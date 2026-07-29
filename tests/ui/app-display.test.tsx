import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppIcon, titleOf } from "../../src/ui/app-display";

describe("应用展示辅助函数", () => {
  it("会话标题按名称、预览和默认文案依次回退", () => {
    expect(titleOf({ name: "命名会话", preview: "预览" })).toBe("命名会话");
    expect(titleOf({ preview: "预览会话" })).toBe("预览会话");
    expect(titleOf({})).toBe("新对话");
  });

  it.each(["back", "search", "compose", "send", "stop", "more"] as const)(
    "%s 图标保持装饰性 SVG 约定",
    (name) => {
      const { container } = render(<AppIcon name={name} />);
      const icon = container.querySelector("svg");

      expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.childElementCount).toBeGreaterThan(0);
    },
  );

  it("接收字符图标只保留向下箭头，不展示下载横线", () => {
    const { container } = render(<AppIcon name="download" />);
    const paths = Array.from(container.querySelectorAll("path"));

    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.getAttribute("d"))).not.toContain(
      "M5 20h14",
    );
  });
});
