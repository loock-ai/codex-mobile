import { describe, expect, it } from "vitest";
import {
  activeTurnId,
  buildTurnSteerParams,
  clearPendingSteerForRequest,
  clearPendingSteerForThread,
  mergeSteerDraft,
} from "../../src/app-server/turn-steering";

describe("运行中引导", () => {
  it("使用最后一个运行中 Turn 作为 expectedTurnId", () => {
    expect(
      activeTurnId({
        turns: [
          { id: "turn-completed", status: "completed" },
          { id: "turn-active", status: "inProgress" },
        ],
      }),
    ).toBe("turn-active");
    expect(activeTurnId({ turns: [{ id: "done", status: "completed" }] }))
      .toBeNull();
  });

  it("不会把前端乐观 pending 回合当作服务器当前回合", () => {
    expect(
      activeTurnId({
        turns: [
          { id: "server-turn", status: "completed" },
          { id: "pending-123", status: "inProgress" },
        ],
      }),
    ).toBeNull();
  });

  it("引导失败时保留发送期间新输入的草稿", () => {
    expect(mergeSteerDraft("后续输入", "原引导")).toBe("原引导\n后续输入");
    expect(mergeSteerDraft("", "原引导")).toBe("原引导");
    expect(mergeSteerDraft("原引导", "原引导")).toBe("原引导");
  });

  it("只在对应请求失败或对应线程结束时移除临时引导", () => {
    const pending = {
      id: "steer-1",
      threadId: "thread-1",
      text: "先运行测试",
    };

    expect(clearPendingSteerForRequest(pending, "steer-other")).toBe(pending);
    expect(clearPendingSteerForRequest(pending, "steer-1")).toBeNull();
    expect(clearPendingSteerForThread(pending, "thread-other")).toBe(pending);
    expect(clearPendingSteerForThread(pending, "thread-1")).toBeNull();
  });

  it("构造 app-server turn/steer 所需的精确参数", () => {
    expect(
      buildTurnSteerParams({
        threadId: "thread-1",
        turnId: "turn-active",
        input: [{ type: "text", text: "先修复测试", text_elements: [] }],
        clientUserMessageId: "client-steer-1",
      }),
    ).toEqual({
      threadId: "thread-1",
      input: [{ type: "text", text: "先修复测试", text_elements: [] }],
      expectedTurnId: "turn-active",
      clientUserMessageId: "client-steer-1",
    });
  });
});
