import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnCard } from "../../src/features/conversation/Timeline";
import {
  RemoteImage,
  RemoteFileLink,
} from "../../src/features/conversation/sheets/RemoteFileSheets";
import { ImagePreviewSheet } from "../../src/features/conversation/sheets/ImagePreviewSheet";

afterEach(cleanup);

describe("图片放大预览", () => {
  it("大图支持按钮缩放和一键还原", () => {
    render(
      <ImagePreviewSheet
        src="data:image/png;base64,iVBORw0KGgo="
        name="preview.png"
        onClose={() => undefined}
      />,
    );

    const image = screen.getByRole("img", { name: "preview.png" });
    expect(screen.getByText("100%")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByText("125%")).not.toBeNull();
    expect(image.getAttribute("style")).toContain("scale(1.25)");
    fireEvent.click(screen.getByRole("button", { name: "还原图片" }));
    expect(screen.getByText("100%")).not.toBeNull();
    expect(image.getAttribute("style")).toContain("scale(1)");
  });

  it("大图支持滚轮和双击手动缩放", () => {
    render(
      <ImagePreviewSheet
        src="data:image/png;base64,iVBORw0KGgo="
        name="gesture.png"
        onClose={() => undefined}
      />,
    );
    const stage = screen
      .getByRole("dialog", { name: "图片预览" })
      .querySelector(".image-preview-stage");
    expect(stage).not.toBeNull();

    fireEvent.wheel(stage!, { deltaY: -100 });
    expect(screen.getByText("125%")).not.toBeNull();

    fireEvent.doubleClick(stage!);
    expect(screen.getByText("100%")).not.toBeNull();
  });

  it("预览层通过 Portal 脱离带 transform 的业务容器", () => {
    const { container } = render(
      <div className="transformed-parent">
        <ImagePreviewSheet
          src="data:image/png;base64,iVBORw0KGgo="
          name="portal.png"
          onClose={() => undefined}
        />
      </div>,
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole("dialog", { name: "图片预览" })).not.toBeNull();
  });

  it("Data URI 不把完整 base64 当作文件名或详情渲染", () => {
    const source =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    render(
      <RemoteImage
        image={{ source, name: source, local: false }}
        client={null}
        alt="内嵌图片"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "查看图片 内嵌图片" }),
    );

    const dialog = screen.getByRole("dialog", { name: "图片预览" });
    expect(dialog.textContent).not.toContain("iVBORw0KGgo");
    expect(
      dialog.querySelector('img[alt="内嵌图片"]'),
    ).not.toBeNull();
  });

  it("远程文件链接指向图片时通过 fs/readFile 打开图片预览", async () => {
    const request = vi.fn().mockResolvedValue({
      dataBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    });
    render(
      <RemoteFileLink
        href="/tmp/screenshot.png"
        client={{ request } as any}
      >
        screenshot.png
      </RemoteFileLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "screenshot.png" }));
    expect(
      await screen.findByRole("dialog", { name: "图片预览" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("img", { name: "screenshot.png" }),
    ).not.toBeNull();
    expect(request).toHaveBeenCalledWith("fs/readFile", {
      path: "/tmp/screenshot.png",
    });
    expect(screen.queryByText(/二进制文件/)).toBeNull();
  });

  it("远程 Markdown 文件默认预览并允许切换源码", async () => {
    const request = vi.fn().mockResolvedValue({
      dataBase64: window.btoa("# Remote docs\n\n**Preview content**"),
    });
    render(
      <RemoteFileLink
        href="/tmp/project/README.md:3"
        client={{ request } as any}
      >
        README.md
      </RemoteFileLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "README.md" }));

    expect(
      await screen.findByRole("heading", { name: "Remote docs" }),
    ).not.toBeNull();
    expect(screen.getByText("Preview content").tagName).toBe("STRONG");
    expect(
      screen.getByRole("button", { name: "预览 Markdown" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText("1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看源码" }));

    expect(screen.getByText("# Remote docs")).not.toBeNull();
    expect(
      document.querySelector(".remote-text-line.target"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "查看源码" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("远程 HTML 文件默认使用隔离预览并允许切换源码", async () => {
    const html = "<!doctype html><html><body><h1>Remote page</h1><script>alert('blocked')</script></body></html>";
    const request = vi.fn().mockResolvedValue({
      dataBase64: window.btoa(html),
    });
    render(
      <RemoteFileLink
        href="/tmp/project/index.html"
        client={{ request } as any}
      >
        index.html
      </RemoteFileLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "index.html" }));

    const preview = await screen.findByTitle("index.html HTML 预览");
    expect(preview.tagName).toBe("IFRAME");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(preview.getAttribute("srcdoc")).toBe(html);
    expect(
      screen.getByRole("button", { name: "预览 HTML" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "查看源码" }));

    expect(screen.getByText(html)).not.toBeNull();
    expect(screen.queryByTitle("index.html HTML 预览")).toBeNull();
  });

  it("用户和 AI Markdown 图片都使用可点击预览入口", async () => {
    render(
      <TurnCard
        client={null}
        turn={{
          id: "turn-images",
          status: "completed",
          items: [
            {
              id: "user-image",
              type: "userMessage",
              text: "![用户图片](https://example.com/user.png)",
            },
            {
              id: "agent-image",
              type: "agentMessage",
              text: "![AI 图片](https://example.com/agent.png)",
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "查看图片 user.png" }),
    ).not.toBeNull();
    const aiImage = screen.getByRole("button", {
      name: "查看图片 agent.png",
    });
    fireEvent.click(aiImage);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "图片预览" }),
      ).not.toBeNull(),
    );
  });
});
