import { beforeEach, describe, expect, it } from "vitest";
import {
  readUnreadThreadIds,
  shouldMarkThreadUnread,
  writeUnreadThreadIds,
} from "../../src/features/threads/thread-unread";

describe("会话未读状态", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("按照机器保存和恢复未读会话", () => {
    writeUnreadThreadIds(
      window.localStorage,
      "mini",
      new Set(["thread-1", "thread-2"]),
    );
    expect(readUnreadThreadIds(window.localStorage, "mini")).toEqual(
      new Set(["thread-1", "thread-2"]),
    );
    expect(readUnreadThreadIds(window.localStorage, "macbook")).toEqual(
      new Set(),
    );
  });

  it("只在会话没有被当前可见页面查看时标记未读", () => {
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: false,
        documentVisible: true,
      }),
    ).toBe(true);
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        conversationVisible: true,
        documentVisible: false,
      }),
    ).toBe(true);
    expect(
      shouldMarkThreadUnread({
        threadId: "thread-1",
        activeThreadId: "thread-2",
        conversationVisible: true,
        documentVisible: true,
      }),
    ).toBe(true);
  });
});
