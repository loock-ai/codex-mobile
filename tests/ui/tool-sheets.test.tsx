import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FileDiffSheet,
  ToolDetailSheet,
} from "../../src/features/conversation/sheets/ToolSheets";

describe("工具 ActionSheet", () => {
  it("命令详情和文件 Diff 都使用统一的叉号关闭按钮", () => {
    const onClose = vi.fn();
    const command = render(
      <ToolDetailSheet
        item={{ type: "commandExecution", command: "pwd", status: "completed" }}
        onClose={onClose}
      />,
    );
    const commandView = within(command.container);
    const commandClose = commandView.getByRole("button", {
      name: "关闭工具详情",
    });
    expect(commandClose.textContent).toBe("×");
    command.unmount();

    const diff = render(
      <FileDiffSheet
        item={{
          type: "fileChange",
          changes: [{ path: "src/App.tsx", diff: "" }],
        }}
        onClose={onClose}
      />,
    );
    const diffView = within(diff.container);
    const diffClose = diffView.getByRole("button", {
      name: "关闭文件修改",
    });
    expect(diffClose.textContent).toBe("×");
    fireEvent.click(diffClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
