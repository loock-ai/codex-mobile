import { describe, expect, it, vi } from "vitest";
import {
  activeThreadAfterArchive,
  setThreadPinned,
} from "../../src/app-server/thread-metadata";

describe("线程元数据", () => {
  it("通过 app-server 持久化置顶状态并返回刷新线程", async () => {
    const thread = { id: "thread-1", isPinned: true };
    const request = vi.fn(async () => ({ thread }));

    await expect(
      setThreadPinned({ request } as any, "thread-1", true),
    ).resolves.toBe(thread);
    expect(request).toHaveBeenCalledWith("thread/metadata/update", {
      threadId: "thread-1",
      isPinned: true,
    });
  });

  it("服务端没有返回目标置顶状态时报告能力不支持", async () => {
    const request = vi.fn(async () => ({
      thread: { id: "thread-1" },
    }));

    await expect(
      setThreadPinned({ request } as any, "thread-1", true),
    ).rejects.toThrow("不支持持久化置顶");
  });

  it("旧归档响应不会清空后来打开的会话", () => {
    const newerThread = { id: "thread-2", turns: [{ id: "turn-2" }] };

    expect(activeThreadAfterArchive(newerThread, "thread-1")).toBe(
      newerThread,
    );
    expect(activeThreadAfterArchive(newerThread, "thread-2")).toBeNull();
  });
});
