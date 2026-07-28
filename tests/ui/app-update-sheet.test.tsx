import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppUpdateSheet } from "../../src/features/update/AppUpdateSheet";
import type { AppUpdateState } from "../../src/features/update/useAppUpdate";

const available: AppUpdateState = {
  phase: "available",
  currentVersion: "0.2.0",
  release: {
    version: "0.2.1",
    tag: "v0.2.1",
    notes: "修复移动端布局\n\n增加自动更新。",
    pageUrl:
      "https://github.com/loock-ai/codex-mobile/releases/tag/v0.2.1",
    downloadUrl:
      "https://github.com/loock-ai/codex-mobile/releases/download/v0.2.1/CodexMobile-v0.2.1.apk",
    sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    size: 12_345,
  },
};

describe("App 更新 Sheet", () => {
  it("发现新版本时展示说明并允许稍后或立即更新", () => {
    const onClose = vi.fn();
    const onInstall = vi.fn();
    render(
      <AppUpdateSheet
        open
        state={available}
        onClose={onClose}
        onInstall={onInstall}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog", { name: "发现新版本" })).not.toBeNull();
    expect(screen.getByText("v0.2.1")).not.toBeNull();
    expect(screen.getByText(/增加自动更新/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("下载、校验和失败状态使用明确反馈", () => {
    const { container, rerender } = render(
      <AppUpdateSheet
        open
        state={{
          ...available,
          phase: "downloading",
          progress: 42,
        }}
        onClose={() => undefined}
        onInstall={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(container.textContent).toContain("正在下载 42%");

    rerender(
      <AppUpdateSheet
        open
        state={{ ...available, phase: "verifying" }}
        onClose={() => undefined}
        onInstall={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(container.textContent).toContain("正在验证安装包");

    const onRetry = vi.fn();
    rerender(
      <AppUpdateSheet
        open
        state={{
          ...available,
          phase: "error",
          error: "安装包校验失败",
        }}
        onClose={() => undefined}
        onInstall={() => undefined}
        onRetry={onRetry}
      />,
    );
    expect(
      container.querySelector('[role="alert"]')?.textContent,
    ).toContain("安装包校验失败");
    fireEvent.click(
      container.querySelector("button.primary") as HTMLButtonElement,
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("关闭时不渲染", () => {
    const { container } = render(
      <AppUpdateSheet
        open={false}
        state={available}
        onClose={() => undefined}
        onInstall={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
