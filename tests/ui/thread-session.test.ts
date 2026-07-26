import { describe, expect, it, vi } from "vitest";
import { resumeThreadSession } from "../../src/app-server/thread-session";

describe("恢复已有 app-server 会话", () => {
  it("优先 thread/resume 并返回线程的有效设置", async () => {
    const request = vi.fn().mockResolvedValue({
      thread: { id: "thread-1", turns: [] },
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
    });
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
  });
});
