import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionSheet } from "../../src/ui/ActionSheet";
import { ActionSheetDownload } from "../../src/ui/ActionSheetDownload";

describe("ActionSheet", () => {
  it("统一渲染遮罩、固定头部、滚动内容和固定底部", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionSheet
        open
        title="命令执行"
        closeLabel="关闭命令执行"
        footer={<button type="button">完成</button>}
        onClose={onClose}
      >
        <p>详情内容</p>
      </ActionSheet>,
    );

    expect(
      screen.getByRole("dialog", { name: "命令执行" }),
    ).not.toBeNull();
    expect(container.querySelector(".action-sheet-backdrop")).not.toBeNull();
    expect(container.querySelector(".action-sheet-header")).not.toBeNull();
    expect(container.querySelector(".action-sheet-body")?.textContent).toBe(
      "详情内容",
    );
    expect(container.querySelector(".action-sheet-footer")).not.toBeNull();

    fireEvent.click(screen.getByText("详情内容"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("关闭命令执行"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭，并允许业务提供右侧操作", () => {
    const onClose = vi.fn();
    const onDownload = vi.fn();
    const { container } = render(
      <ActionSheet
        open
        title="远程文件"
        onClose={onClose}
        headerActions={
          <button type="button" onClick={onDownload}>
            下载
          </button>
        }
      >
        文件内容
      </ActionSheet>,
    );
    const view = within(container);

    expect(view.getByRole("button", { name: "关闭" }).textContent).toBe("×");
    fireEvent.click(view.getByRole("button", { name: "下载" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(
      container.querySelector(".action-sheet-backdrop") as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开后管理焦点、循环 Tab、响应 Escape 并恢复触发元素", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开";
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { container, unmount } = render(
      <ActionSheet
        open
        title="状态"
        onClose={onClose}
        footer={<button type="button">完成</button>}
      >
        <button type="button">内容操作</button>
      </ActionSheet>,
    );

    const view = within(container);
    const close = view.getByRole("button", { name: "关闭" });
    const complete = view.getByRole("button", { name: "完成" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(complete);
    fireEvent.keyDown(complete, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("不可通过遮罩关闭时也禁用 Escape", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionSheet
        open
        title="审批"
        onClose={onClose}
        closeOnBackdrop={false}
      >
        审批内容
      </ActionSheet>,
    );

    fireEvent.keyDown(screen.getByRole("dialog", { name: "审批" }), {
      key: "Escape",
    });
    fireEvent.click(
      container.querySelector(".action-sheet-backdrop") as HTMLElement,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("关闭状态不渲染", () => {
    const { container } = render(
      <ActionSheet open={false} title="状态">
        不应展示
      </ActionSheet>,
    );

    expect(container.childElementCount).toBe(0);
  });

  it("图片和远程文件复用同一个下载操作样式", () => {
    const { rerender } = render(
      <ActionSheetDownload
        href="data:image/png;base64,AA=="
        filename="preview.png"
        label="下载图片"
      />,
    );
    const imageDownload = screen.getByRole("link", { name: "下载图片" });
    expect(imageDownload.className).toBe("action-sheet-download");
    expect(imageDownload.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 24 24",
    );

    rerender(
      <ActionSheetDownload
        href="data:text/plain;base64,QQ=="
        filename="file.txt"
        label="下载文件"
      />,
    );
    expect(
      screen.getByRole("link", { name: "下载文件" }).className,
    ).toBe(imageDownload.className);
  });
});
