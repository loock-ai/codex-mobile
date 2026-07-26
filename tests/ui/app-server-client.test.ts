import { describe, expect, it } from "vitest";
import { AppServerClient } from "../../src/app-server/client";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {}

  receive(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }
}

describe("AppServerClient", () => {
  it("初始化后发送 initialized 并加载线程列表", async () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const ready = client.initialize();

    const initialize = JSON.parse(socket.sent[0]);
    expect(initialize.method).toBe("initialize");
    expect(initialize.params.capabilities.experimentalApi).toBe(true);

    socket.receive({
      id: initialize.id,
      result: {
        userAgent: "codex-cli/0.144.1",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
    });
    await ready;

    expect(JSON.parse(socket.sent[1])).toEqual({
      method: "initialized",
      params: {},
    });

    const list = client.request("thread/list", { limit: 20 });
    const listRequest = JSON.parse(socket.sent[2]);
    socket.receive({
      id: listRequest.id,
      result: { data: [], nextCursor: null },
    });

    await expect(list).resolves.toEqual({ data: [], nextCursor: null });
  });

  it("分发服务器通知", () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    const received: unknown[] = [];
    client.onNotification((notification) => received.push(notification));

    socket.receive({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "active" } },
    });

    expect(received).toHaveLength(1);
  });

  it("可以用 JSON-RPC 错误拒绝不支持的服务器请求", () => {
    const socket = new FakeSocket();
    const client = new AppServerClient(socket as unknown as WebSocket);
    client.respondError(9, -32601, "unsupported");
    expect(JSON.parse(socket.sent[0])).toEqual({
      id: 9,
      error: { code: -32601, message: "unsupported" },
    });
  });
});
