import { createRef, type FormEvent } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";
import type { DraftImage } from "../../src/ui/attachments";

function renderConversation(
  olderTurnsState: "idle" | "loading" | "error" | "exhausted",
  onLoadOlderTurns = vi.fn().mockResolvedValue(true),
  composer: {
    draft?: string;
    busy?: boolean;
    steering?: boolean;
    steerable?: boolean;
    pendingSteerText?: string;
    draftImages?: DraftImage[];
    onSubmit?: (event: FormEvent) => void;
  } = {},
  onRetry = vi.fn(),
) {
  const onSubmit = composer.onSubmit ?? vi.fn();
  const result = render(
    <ConversationPage
      active={{
        id: "thread-1",
        cwd: "/tmp/project",
        preview: "分页会话",
        turns: [{ id: "turn-10", items: [] }],
      }}
      backendId="mini"
      backendName="Mac mini"
      backends={[]}
      projectOptions={[]}
      loadState="ready"
      loadError=""
      olderTurnsState={olderTurnsState}
      connection="online"
      client={null}
      error=""
      draft={composer.draft ?? ""}
      draftImages={composer.draftImages ?? []}
      imageReading={false}
      busy={composer.busy ?? false}
      steering={composer.steering ?? false}
      steerable={composer.steerable ?? true}
      pendingSteerText={composer.pendingSteerText ?? ""}
      tokenUsage={null}
      rateLimits={null}
      pendingAction=""
      selectedServiceTier={null}
      selectedModelLabel="Codex"
      selectedEffort={null}
      selectedPermissionLabel="工作区"
      imageInputRef={createRef<HTMLInputElement>()}
      onBack={() => undefined}
      onNewChatBackendChange={() => undefined}
      onNewChatProjectChange={() => undefined}
      onPin={async () => true}
      onRename={async () => true}
      onArchive={async () => true}
      onRetry={onRetry}
      onLoadOlderTurns={onLoadOlderTurns}
      onSubmit={onSubmit}
      onRemoveImage={() => undefined}
      onSelectImages={async () => undefined}
      onOpenAgentSettings={() => undefined}
      onOpenPermissionSettings={() => undefined}
      onDraftChange={() => undefined}
      onInterrupt={() => undefined}
    />,
  );
  return { ...result, onLoadOlderTurns, onSubmit, onRetry };
}

describe("会话详情历史分页", () => {
  it("右上角两个操作入口位于同一个按钮组", () => {
    const { container } = renderConversation("exhausted");
    const view = within(container);
    const group = view.getByRole("group", { name: "会话详情操作" });

    expect(
      within(group).getByRole("button", { name: "查看上下文占用情况" }),
    ).not.toBeNull();
    expect(
      within(group).getByRole("button", { name: "会话操作" }),
    ).not.toBeNull();
  });

  it("会话操作菜单可以刷新当前会话并自动关闭", () => {
    const onRetry = vi.fn();
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {},
      onRetry,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "会话操作" }));
    fireEvent.click(view.getByRole("button", { name: "刷新会话" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(view.queryByRole("region", { name: "会话操作" })).toBeNull();
  });

  it("用户上滑后不显示悬浮回到底部按钮", () => {
    const { container } = renderConversation("exhausted");
    const scroller = container.querySelector(".conversation-scroll");
    expect(scroller).not.toBeNull();
    Object.defineProperties(scroller!, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });

    fireEvent.scroll(scroller!);

    expect(
      within(container).queryByRole("button", { name: "回到最新消息" }),
    ).toBeNull();
  });

  it("有更早历史时显示入口并只请求一次分页", () => {
    const { container, onLoadOlderTurns } = renderConversation("idle");
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "加载更早消息" }));

    expect(onLoadOlderTurns).toHaveBeenCalledOnce();
  });

  it("分页失败时保留详情并显示局部重试", () => {
    const { container } = renderConversation("error");
    const view = within(container);

    expect(view.getByText("加载失败，点击重试")).not.toBeNull();
    expect(view.getByText("分页会话")).not.toBeNull();
  });

  it("任务执行中输入内容后，停止按钮直接变成引导发送按钮", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { draft: "先处理测试", busy: true, onSubmit },
    );
    const view = within(container);
    const steer = view.getByRole("button", { name: "引导" });

    expect(steer.getAttribute("type")).toBe("submit");
    expect(view.queryByRole("button", { name: "停止" })).toBeNull();
    fireEvent.click(steer);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("任务执行中没有输入时保留停止按钮，引导提交中显示等待状态", () => {
    const idle = renderConversation(
      "exhausted",
      undefined,
      { busy: true },
    );
    expect(
      within(idle.container).getByRole("button", { name: "停止" }),
    ).not.toBeNull();
    idle.unmount();

    const pending = renderConversation(
      "exhausted",
      undefined,
      { draft: "继续", busy: true, steering: true },
    );
    const steering = within(pending.container).getByRole("button", {
      name: "正在引导",
    });
    expect(steering.getAttribute("disabled")).not.toBeNull();
  });

  it("空闲已有会话且输入为空时显示实时语音入口", () => {
    const { container } = renderConversation("exhausted");
    const view = within(container);

    expect(view.getByRole("button", { name: "开始实时语音" })).not.toBeNull();
    expect(view.queryByRole("button", { name: "发送" })).toBeNull();
  });

  it("输入文字后仍显示原发送按钮，不改变文字提交", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { draft: "继续完成测试", onSubmit },
    );
    const view = within(container);

    expect(view.queryByRole("button", { name: "开始实时语音" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "发送" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("引导发送后在输入框上方临时展示单行消息", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        busy: true,
        pendingSteerText:
          "先完成当前检查，再根据测试结果调整实现并重新运行完整测试",
      },
    );
    const view = within(container);
    const preview = view.getByRole("status", { name: "已发送引导" });

    expect(preview.textContent).toBe(
      "先完成当前检查，再根据测试结果调整实现并重新运行完整测试",
    );
    expect(preview.getAttribute("title")).toBe(preview.textContent);
  });

  it("真实 Turn ID 尚未返回时不允许把 pending 回合当作引导目标", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      { draft: "继续", busy: true, steerable: false },
    );
    const view = within(container);

    expect(view.getByRole("button", { name: "停止" })).not.toBeNull();
    expect(view.queryByRole("button", { name: "引导" })).toBeNull();
  });

  it("待发送图片可以打开统一大图预览", () => {
    const { container } = renderConversation(
      "exhausted",
      undefined,
      {
        draftImages: [
          {
            id: "draft-image",
            name: "draft.png",
            type: "image/png",
            size: 68,
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "预览 draft.png" }));

    const preview = within(document.body).getByRole("dialog", {
      name: "图片预览",
    });
    expect(
      within(preview).getByRole("img", { name: "待发送 draft.png" }),
    ).not.toBeNull();
  });
});
