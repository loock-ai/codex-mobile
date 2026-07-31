import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBanner } from "../../src/ui/ErrorBanner";

describe("错误提示框", () => {
  it("支持手动关闭，并在新错误出现时重新展示", () => {
    const { container, rerender } = render(
      <ErrorBanner message="第一次请求失败" />,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "关闭错误提示" }));
    expect(view.queryByRole("alert")).toBeNull();

    rerender(<ErrorBanner message="第二次请求失败" />);
    expect(view.getByRole("alert").textContent).toContain("第二次请求失败");
  });
});
