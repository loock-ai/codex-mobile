import { describe, expect, it, vi } from "vitest";
import {
  loadRecoverableRecentThreadTurns,
  loadRecentThreadTurns,
  loadStableRecentThreadTurns,
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

  it("获取最新完整 turns 用于回到前台后的增量对账", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        { id: "turn-3", status: "completed" },
        { id: "turn-2", status: "completed" },
      ],
      nextCursor: "older",
    });

    const result = await loadRecentThreadTurns(
      { request },
      "thread-1",
    );

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "thread-1",
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result.map((turn) => turn.id)).toEqual(["turn-2", "turn-3"]);
  });

  it("对账请求期间收到实时事件时重新读取稳定快照", async () => {
    let notificationSequence = 0;
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        notificationSequence += 1;
        return { data: [{ id: "turn-stale" }] };
      })
      .mockResolvedValueOnce({ data: [{ id: "turn-current" }] });

    const result = await loadStableRecentThreadTurns(
      { request },
      "thread-1",
      () => notificationSequence,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(result?.map((turn) => turn.id)).toEqual(["turn-current"]);
  });

  it("前台恢复快照短暂失败时按退避重试且不要求重连", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ data: [{ id: "turn-current" }] });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await loadRecoverableRecentThreadTurns(
      { request },
      "thread-1",
      () => 0,
      wait,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(300);
    expect(result?.map((turn) => turn.id)).toEqual(["turn-current"]);
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
