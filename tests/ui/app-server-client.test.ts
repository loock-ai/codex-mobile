import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../../src/app-server/client";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

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

  it("普通请求超时后关闭半开连接并拒绝等待中的请求", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new AppServerClient(
      socket as unknown as WebSocket,
      { requestTimeoutMs: 1_000 },
    );

    const request = client.request("thread/list", { limit: 5 });
    const rejection = expect(request).rejects.toThrow(
      "thread/list 请求超时",
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(socket.closed).toEqual([
      { code: 4000, reason: "request timeout" },
    ]);
    vi.useRealTimers();
  });

  it("连接不是打开状态时不会发送请求", async () => {
    const socket = new FakeSocket();
    socket.readyState = WebSocket.CLOSED;
    const client = new AppServerClient(socket as unknown as WebSocket);

    await expect(
      client.request("thread/list", { limit: 5 }),
    ).rejects.toThrow("与 app-server 的连接不可用");
    expect(socket.sent).toHaveLength(0);
  });
});
