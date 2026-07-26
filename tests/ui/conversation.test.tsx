import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  MarkdownMessage,
  groupTimelineEntries,
  groupTurnItems,
  imageSourcesForItem,
  isThreadRunning,
  parseRemoteFileHref,
  relativeTime,
  removePendingTurn,
  parseUnifiedDiff,
  shouldCollapseUserMessage,
  splitCompletedTurnResponses,
  summarizeToolActivity,
  summarizeFileChange,
  toolActivityRowLabel,
} from "../../src/ui/conversation";

describe("移动端对话格式", () => {
  it("相对时间使用数字在前、单位在后", () => {
    expect(relativeTime(100, 220)).toBe("2 分钟");
    expect(relativeTime(100, 7_300)).toBe("2 小时");
    expect(relativeTime(100, 172_900)).toBe("2 天");
  });

  it("只把协议中的 active 线程标记为进行中", () => {
    expect(isThreadRunning({ type: "active", activeFlags: [] })).toBe(true);
    expect(isThreadRunning({ type: "idle" })).toBe(false);
    expect(isThreadRunning({ type: "notLoaded" })).toBe(false);
    expect(isThreadRunning("running")).toBe(false);
  });

  it("每个 Turn 分离用户标题和其后的 AI 内容", () => {
    expect(
      groupTurnItems({
        id: "turn-1",
        status: "completed",
        items: [
          { id: "u1", type: "userMessage", text: "问题" },
          { id: "a1", type: "agentMessage", text: "答案" },
          { id: "c1", type: "commandExecution", command: "pwd" },
        ],
      }),
    ).toEqual({
      id: "turn-1",
      running: false,
      user: { id: "u1", type: "userMessage", text: "问题" },
      responses: [
        { id: "a1", type: "agentMessage", text: "答案" },
        { id: "c1", type: "commandExecution", command: "pwd" },
      ],
    });
  });

  it("把连续的工具与文件活动合并，但保留 AI 消息顺序", () => {
    const entries = groupTimelineEntries([
      { id: "a1", type: "agentMessage", text: "先检查" },
      { id: "c1", type: "commandExecution", command: "rg foo" },
      {
        id: "f1",
        type: "fileChange",
        changes: [{ path: "src/a.ts", diff: "+const a = 1", kind: "update" }],
      },
      { id: "a2", type: "agentMessage", text: "检查完成" },
      { id: "m1", type: "mcpToolCall", tool: "browser_open" },
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "item",
      "activity",
      "item",
      "activity",
    ]);
    expect(entries[1]).toMatchObject({
      kind: "activity",
      items: [{ id: "c1" }, { id: "f1" }],
    });
  });

  it("从真实工具字段汇总文件、命令、工具和 diff 增删行", () => {
    expect(
      summarizeToolActivity([
        { type: "commandExecution", status: "completed" },
        { type: "commandExecution", status: "inProgress" },
        {
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "src/a.ts",
              diff: "@@\n+one\n+two\n-old",
            },
            {
              path: "src/b.ts",
              diff: "@@\n+three",
            },
          ],
        },
        { type: "dynamicToolCall", status: "completed" },
      ]),
    ).toEqual({
      fileCount: 2,
      commandCount: 2,
      toolCount: 1,
      additions: 3,
      deletions: 1,
      running: true,
    });
  });

  it("解析 unified diff 的 hunk、行号与增删类型", () => {
    expect(
      parseUnifiedDiff(
        "@@ -138,3 +138,4 @@\n context\n-old value\n+new value\n+another value\n tail",
      ),
    ).toEqual([
      {
        type: "hunk",
        text: "@@ -138,3 +138,4 @@",
        oldLine: null,
        newLine: null,
      },
      {
        type: "context",
        text: "context",
        oldLine: 138,
        newLine: 138,
      },
      {
        type: "deletion",
        text: "old value",
        oldLine: 139,
        newLine: null,
      },
      {
        type: "addition",
        text: "new value",
        oldLine: null,
        newLine: 139,
      },
      {
        type: "addition",
        text: "another value",
        oldLine: null,
        newLine: 140,
      },
      {
        type: "context",
        text: "tail",
        oldLine: 140,
        newLine: 141,
      },
    ]);
  });

  it("文件 Diff 统计忽略头部，并对无 hunk 内容安全回退", () => {
    expect(
      summarizeFileChange({
        path: "src/App.tsx",
        diff: "--- a/src/App.tsx\n+++ b/src/App.tsx\n-old\n+new\n+next",
      }),
    ).toEqual({
      additions: 2,
      deletions: 1,
    });
    expect(parseUnifiedDiff("+new\n-old")).toEqual([
      {
        type: "addition",
        text: "new",
        oldLine: null,
        newLine: null,
      },
      {
        type: "deletion",
        text: "old",
        oldLine: null,
        newLine: null,
      },
    ]);
  });

  it("命令行标签优先使用 commandActions 表达读取与搜索", () => {
    expect(
      toolActivityRowLabel({
        type: "commandExecution",
        status: "completed",
        command: "sed -n '1,20p' src/App.tsx",
        commandActions: [
          {
            type: "read",
            name: "App.tsx",
            path: "/repo/src/App.tsx",
          },
        ],
      }),
    ).toBe("已读取 App.tsx");
    expect(
      toolActivityRowLabel({
        type: "commandExecution",
        status: "inProgress",
        command: "npm run dev",
        commandActions: [{ type: "unknown" }],
      }),
    ).toBe("正在运行 npm run dev");
  });

  it("从用户输入、图片查看和图片生成 item 提取真实图片来源", () => {
    expect(
      imageSourcesForItem({
        type: "userMessage",
        content: [
          { type: "text", text: "看图" },
          { type: "localImage", path: "/tmp/user.png" },
          { type: "image", url: "https://example.com/remote.jpg" },
        ],
      }),
    ).toEqual([
      { source: "/tmp/user.png", name: "user.png", local: true },
      {
        source: "https://example.com/remote.jpg",
        name: "remote.jpg",
        local: false,
      },
    ]);
    expect(
      imageSourcesForItem({ type: "imageView", path: "/tmp/view.webp" }),
    ).toEqual([{ source: "/tmp/view.webp", name: "view.webp", local: true }]);
    expect(
      imageSourcesForItem({
        type: "imageGeneration",
        savedPath: "/tmp/generated.png",
        result: "ignored",
      }),
    ).toEqual([
      { source: "/tmp/generated.png", name: "generated.png", local: true },
    ]);
  });

  it("长文本或多行用户消息默认折叠，短消息保持完整", () => {
    expect(shouldCollapseUserMessage("简短问题")).toBe(false);
    expect(shouldCollapseUserMessage("一行\n".repeat(9))).toBe(true);
    expect(shouldCollapseUserMessage("很长的用户消息".repeat(40))).toBe(true);
  });

  it("完成回合只保留最后一条 AI 回复，其余过程按原 item 数量折叠", () => {
    const early = { id: "a1", type: "agentMessage", text: "先检查" };
    const command = { id: "c1", type: "commandExecution" };
    const final = { id: "a2", type: "agentMessage", text: "最终答案" };
    const result = splitCompletedTurnResponses([early, command, final]);

    expect(result.final).toBe(final);
    expect(result.previous).toEqual([early, command]);
    expect(result.previousCount).toBe(2);
  });

  it("没有 AI 最终回复时不丢弃过程 item", () => {
    const command = { id: "c1", type: "commandExecution" };
    expect(splitCompletedTurnResponses([command])).toEqual({
      final: null,
      previous: [command],
      previousCount: 1,
    });
  });

  it("turn/completed 只合并最终摘要，不丢失本地累计的完整过程", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "inProgress",
          items: [
            { id: "u1", type: "userMessage", text: "问题" },
            { id: "r1", type: "reasoning", text: "检查中" },
            { id: "c1", type: "commandExecution", command: "npm test" },
          ],
        },
      ],
    };
    const completedTurn = {
      id: "turn-1",
      status: "completed",
      items: [
        { id: "a1", type: "agentMessage", text: "最终答案" },
      ],
    };

    expect(
      applyCompletedTurn(thread, {
        threadId: "thread-1",
        turn: completedTurn,
      }),
    ).toEqual({
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            { id: "u1", type: "userMessage", text: "问题" },
            { id: "r1", type: "reasoning", text: "检查中" },
            { id: "c1", type: "commandExecution", command: "npm test" },
            { id: "a1", type: "agentMessage", text: "最终答案" },
          ],
        },
      ],
    });
    expect(
      applyCompletedTurn(thread, {
        threadId: "other-thread",
        turn: completedTurn,
      }),
    ).toBe(thread);
  });

  it("turn/started 将本地 pending 回合升级为真实回合且保留用户消息", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "old-turn",
          status: "completed",
          items: [{ id: "old", type: "agentMessage", text: "旧回复" }],
        },
        {
          id: "pending-1",
          status: "inProgress",
          items: [{ id: "local-1", type: "userMessage", text: "新问题" }],
        },
      ],
    };
    const started = applyTurnStarted(thread, {
      threadId: "thread-1",
      turn: { id: "new-turn", status: "inProgress", items: [] },
    });

    expect(started.turns).toHaveLength(2);
    expect(started.turns[1]).toMatchObject({
      id: "new-turn",
      status: "inProgress",
      items: [{ id: "local-1", type: "userMessage", text: "新问题" }],
    });
  });

  it("turn/start 失败时只删除对应的乐观 pending 回合", () => {
    const thread = {
      id: "thread-1",
      turns: [
        { id: "old-turn", status: "completed", items: [] },
        { id: "pending-failed", status: "inProgress", items: [] },
        { id: "pending-other", status: "inProgress", items: [] },
      ],
    };

    expect(removePendingTurn(thread, "pending-failed").turns).toEqual([
      thread.turns[0],
      thread.turns[2],
    ]);
    expect(removePendingTurn(thread, "missing")).toBe(thread);
  });

  it("未知 turn 的 item 创建目标回合，不污染最后一个旧回合", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "old-turn",
          status: "completed",
          items: [{ id: "old", type: "agentMessage", text: "旧回复" }],
        },
      ],
    };
    const updated = applyTurnItem(thread, {
      threadId: "thread-1",
      turnId: "new-turn",
      item: { id: "c1", type: "commandExecution", command: "pwd" },
    });

    expect(updated.turns[0].items).toEqual(thread.turns[0].items);
    expect(updated.turns[1]).toMatchObject({
      id: "new-turn",
      status: "inProgress",
      items: [{ id: "c1", type: "commandExecution", command: "pwd" }],
    });
  });

  it("turn diff 只写入所属回合", () => {
    const thread = {
      id: "thread-1",
      turns: [
        { id: "turn-1", status: "completed", items: [] },
        { id: "turn-2", status: "inProgress", items: [] },
      ],
    };
    const updated = applyTurnDiff(thread, {
      threadId: "thread-1",
      turnId: "turn-1",
      diff: "+old turn",
    });

    expect(updated.turns[0].liveDiff).toBe("+old turn");
    expect(updated.turns[1].liveDiff).toBeUndefined();
  });

  it("fileChange patchUpdated 更新对应 item 且不清空 turn diff", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "inProgress",
          liveDiff: "+aggregated",
          items: [
            {
              id: "file-1",
              type: "fileChange",
              status: "inProgress",
              changes: [],
            },
          ],
        },
      ],
    };
    const changes = [
      { path: "/tmp/App.tsx", kind: "update", diff: "+const ok = true;" },
    ];
    const updated = applyFileChangePatch(thread, {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "file-1",
      changes,
    });

    expect(updated.turns[0].liveDiff).toBe("+aggregated");
    expect(updated.turns[0].items[0].changes).toEqual(changes);
  });

  it("AI 消息按 Markdown 渲染且不执行 HTML", () => {
    render(
      <MarkdownMessage text={"**加粗**\n\n- 第一项\n\n<script>alert(1)</script>"} />,
    );
    expect(screen.getByText("加粗").tagName).toBe("STRONG");
    expect(screen.getByText("第一项").tagName).toBe("LI");
    expect(document.querySelector("script")).toBeNull();
  });

  it("Markdown 渲染器允许用户气泡添加紧凑样式 class", () => {
    const { container } = render(
      <MarkdownMessage
        text={"# 用户标题\n\n**用户粗体**\n\n- 用户列表"}
        className="user-markdown"
      />,
    );
    expect(container.querySelector(".markdown-body.user-markdown h1")?.textContent)
      .toBe("用户标题");
    expect(container.querySelector(".user-markdown strong")?.textContent)
      .toBe("用户粗体");
    expect(container.querySelector(".user-markdown li")?.textContent)
      .toBe("用户列表");
  });

  it("识别远程文件路径与尾部行列号，不拦截网页链接", () => {
    expect(
      parseRemoteFileHref(
        "/Users/loock/project/src/App.tsx:1173:5",
      ),
    ).toEqual({
      path: "/Users/loock/project/src/App.tsx",
      line: 1173,
      column: 5,
    });
    expect(
      parseRemoteFileHref("file:///tmp/project/README.md:8"),
    ).toEqual({
      path: "/tmp/project/README.md",
      line: 8,
      column: null,
    });
    expect(parseRemoteFileHref("https://example.com/App.tsx")).toBeNull();
    expect(parseRemoteFileHref("/docs/getting-started")).toBeNull();
    expect(parseRemoteFileHref("#section")).toBeNull();
  });

  it("Markdown 渲染器允许调用方接管文件链接渲染", () => {
    render(
      <MarkdownMessage
        text={"[App.tsx](/Users/loock/project/src/App.tsx:12)"}
        renderLink={(href, children) => (
          <button type="button" data-href={href}>
            {children}
          </button>
        )}
      />,
    );
    expect(
      screen.getByRole("button", { name: "App.tsx" }).getAttribute("data-href"),
    ).toBe("/Users/loock/project/src/App.tsx:12");
  });
});
