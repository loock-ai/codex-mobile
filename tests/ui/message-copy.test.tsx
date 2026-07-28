import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnCard } from "../../src/features/conversation/Timeline";
import { copyText } from "../../src/ui/copy";
import { MarkdownMessage } from "../../src/ui/conversation";

function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: undefined,
  });
});

describe("消息复制", () => {
  it("只给块级代码增加复制按钮并复制代码正文", async () => {
    const writeText = mockClipboard();
    render(
      <MarkdownMessage
        text={[
          "行内 `const inline = true`",
          "",
          "```ts",
          "const block = true;",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getAllByRole("button", { name: "复制代码块" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "复制代码块" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("const block = true;"),
    );
    expect(screen.getByRole("status").textContent).toBe("已复制");
  });

  it("完成回合折叠时只复制最终 AI 纯文本，展开后复制全部可见 AI 文本", async () => {
    const writeText = mockClipboard();
    render(
      <TurnCard
        client={null}
        turn={{
          id: "turn-copy",
          status: "completed",
          items: [
            { id: "user", type: "userMessage", text: "用户秘密" },
            {
              id: "early",
              type: "agentMessage",
              text: "**早期** 回复",
            },
            {
              id: "reasoning",
              type: "reasoning",
              text: "思考秘密",
            },
            {
              id: "tool",
              type: "commandExecution",
              command: "echo 工具秘密",
              status: "completed",
            },
            {
              id: "final",
              type: "agentMessage",
              phase: "final_answer",
              text: "## 最终\n\n答案 `ok`",
            },
          ],
        }}
      />,
    );

    const copy = screen.getByRole("button", {
      name: "复制本回合 AI 消息",
    });
    expect(
      screen.getAllByRole("button", { name: "复制本回合 AI 消息" }),
    ).toHaveLength(1);

    fireEvent.click(copy);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("最终\n\n答案 ok"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "之前的 3 条消息" }),
    );
    fireEvent.click(copy);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        "早期 回复\n\n最终\n\n答案 ok",
      ),
    );
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain("用户秘密");
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain("思考秘密");
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain("工具秘密");
  });

  it("流式回复尚未完成时不显示消息级复制按钮", () => {
    render(
      <TurnCard
        client={null}
        turn={{
          id: "turn-running",
          status: "inProgress",
          items: [
            { id: "user", type: "userMessage", text: "继续" },
            { id: "agent", type: "agentMessage", text: "正在生成" },
          ],
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "复制本回合 AI 消息" }),
    ).toBeNull();
  });

  it("Clipboard API 失败时回退到文本框复制", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyText("回退文本")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("两种复制方式都失败时显示失败反馈", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    render(<MarkdownMessage text={"```\n失败内容\n```"} />);

    fireEvent.click(screen.getByRole("button", { name: "复制代码块" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("复制失败"),
    );
  });
});
