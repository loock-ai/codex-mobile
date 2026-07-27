import { describe, expect, it, vi } from "vitest";
import {
  loadOlderThreadTurns,
  prependUniqueTurns,
  resumeThreadSession,
} from "../../src/app-server/thread-session";

describe("恢复已有 app-server 会话", () => {
  it("优先 thread/resume 并返回线程的有效设置", async () => {
    const request = vi.fn().mockResolvedValue({
      thread: { id: "thread-1", turns: [] },
      initialTurnsPage: {
        data: [
          { id: "turn-2", items: [{ id: "item-2" }] },
          { id: "turn-1", items: [{ id: "item-1" }] },
        ],
        nextCursor: "older-cursor",
      },
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      serviceTier: "priority",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      activePermissionProfile: { id: ":workspace" },
    });

    const result = await resumeThreadSession({ request }, "thread-1");

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("thread/resume", {
      threadId: "thread-1",
      excludeTurns: true,
      initialTurnsPage: {
        limit: 10,
        sortDirection: "desc",
        itemsView: "full",
      },
    });
    expect(result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextTurnsCursor).toBe("older-cursor");
    expect(result.settingsSynchronized).toBe(true);
    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.reasoningEffort).toBe("high");
    expect(result.serviceTier).toBe("priority");
    expect(result.approvalPolicy).toBe("on-request");
    expect(result.approvalsReviewer).toBe("auto_review");
    expect(result.activePermissionProfile?.id).toBe(":workspace");
  });

  it("resume 不可用时回退 thread/read，且标记设置未同步", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("thread is owned by another app-server"))
      .mockResolvedValueOnce({ thread: { id: "thread-1", turns: [] } });

    const result = await resumeThreadSession({ request }, "thread-1");

    expect(request).toHaveBeenNthCalledWith(2, "thread/read", {
      threadId: "thread-1",
      includeTurns: true,
    });
    expect(result.settingsSynchronized).toBe(false);
    expect(result.thread.id).toBe("thread-1");
    expect(result.nextTurnsCursor).toBeNull();
  });

  it("使用游标获取更早 turns 并转换为时间正序", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ id: "turn-2" }, { id: "turn-1" }],
      nextCursor: "next-older",
    });

    const result = await loadOlderThreadTurns(
      { request },
      "thread-1",
      "older-cursor",
    );

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "thread-1",
      cursor: "older-cursor",
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result.turns.map((turn) => String(turn.id))).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextCursor).toBe("next-older");
  });

  it("向前插入分页结果时按 id 去重且保留现有实时 turn", () => {
    expect(
      prependUniqueTurns(
        [{ id: "turn-2" }, { id: "turn-3", status: "running" }],
        [{ id: "turn-1" }, { id: "turn-2", status: "completed" }],
      ),
    ).toEqual([
      { id: "turn-1" },
      { id: "turn-2" },
      { id: "turn-3", status: "running" },
    ]);
  });
});
