import { createRef } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "../../src/features/conversation/ConversationPage";

function renderConversation(
  olderTurnsState: "idle" | "loading" | "error" | "exhausted",
  onLoadOlderTurns = vi.fn().mockResolvedValue(true),
) {
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
      draft=""
      draftImages={[]}
      imageReading={false}
      busy={false}
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
      onRetry={() => undefined}
      onLoadOlderTurns={onLoadOlderTurns}
      onSubmit={() => undefined}
      onRemoveImage={() => undefined}
      onSelectImages={async () => undefined}
      onOpenAgentSettings={() => undefined}
      onOpenPermissionSettings={() => undefined}
      onDraftChange={() => undefined}
      onInterrupt={() => undefined}
    />,
  );
  return { ...result, onLoadOlderTurns };
}

describe("会话详情历史分页", () => {
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
});
