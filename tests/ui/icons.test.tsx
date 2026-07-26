import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chevron } from "../../src/ui/icons";

describe("统一 Chevron 图标", () => {
  it("所有方向共用同一条 SVG 路径，仅方向 class 不同", () => {
    const { container, rerender } = render(
      <Chevron direction="right" data-testid="chevron" />,
    );
    const right = container.querySelector("svg")!;
    const path = right.querySelector("path")!.getAttribute("d");
    expect([...right.classList]).toEqual(
      expect.arrayContaining(["chevron-icon", "direction-right"]),
    );

    rerender(<Chevron direction="down" data-testid="chevron" />);
    const down = container.querySelector("svg")!;
    expect([...down.classList]).toEqual(
      expect.arrayContaining(["chevron-icon", "direction-down"]),
    );
    expect(down.querySelector("path")!.getAttribute("d")).toBe(path);

    rerender(<Chevron direction="up" data-testid="chevron" />);
    const up = container.querySelector("svg")!;
    expect([...up.classList]).toEqual(
      expect.arrayContaining(["chevron-icon", "direction-up"]),
    );
    expect(up.querySelector("path")!.getAttribute("d")).toBe(path);
  });
});
