import { describe, expect, it, vi } from "vitest";
import {
  BackendConnectionManager,
  backendWebSocketUrl,
  type BackendClient,
  type WebSocketLike,
} from "../../src/backends/connection-manager";
import type { BackendConfig } from "../../src/backends/types";
import type { RpcMessage } from "../../src/app-server/client";

class FakeSocket implements WebSocketLike {
  readyState: number = WebSocket.CONNECTING;
  closed = false;
  private listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void) {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  close() {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", {});
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.emit("open", {});
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeClient implements BackendClient {
  initialize = vi.fn(async () => ({}));
  request = vi.fn(async () => ({})) as BackendClient["request"];
  notify = vi.fn();
  respond = vi.fn();
  respondError = vi.fn();
  private notifications = new Set<(message: RpcMessage) => void>();
  private requests = new Set<(message: RpcMessage) => void>();

  onNotification(listener: (message: RpcMessage) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onRequest(listener: (message: RpcMessage) => void) {
    this.requests.add(listener);
    return () => this.requests.delete(listener);
  }

  emitNotification(message: RpcMessage) {
    for (const listener of this.notifications) listener(message);
  }

  emitRequest(message: RpcMessage) {
    for (const listener of this.requests) listener(message);
  }
}

function backend(
  id: string,
  baseUrl: string,
  token = "",
): BackendConfig {
  return {
    id,
    name: id,
    baseUrl,
    token,
    enabled: true,
    order: 0,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("多后端连接池", () => {
  it("从 HTTP 地址构造带口令的 WebSocket 地址", () => {
    expect(
      backendWebSocketUrl(
        backend("mini", "http://192.168.100.8:4173", "a b"),
      ),
    ).toBe("ws://192.168.100.8:4173/ws?token=a+b");
    expect(
      backendWebSocketUrl(
        backend("secure", "https://mini.example", ""),
      ),
    ).toBe("wss://mini.example/ws");
  });

  it("同时连接并初始化两个启用的后端", async () => {
    const sockets: FakeSocket[] = [];
    const clients: FakeClient[] = [];
    const statuses: Array<[string, string]> = [];
    const ready: string[] = [];
    const manager = new BackendConnectionManager({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => {
        const client = new FakeClient();
        clients.push(client);
        return client;
      },
      onConnection: (backendId, status) =>
        statuses.push([backendId, status]),
      onReady: (backendId) => ready.push(backendId),
    });

    manager.sync([
      backend("mini", "http://192.168.100.8:4173"),
      backend("macbook", "http://192.168.100.35:4173"),
    ]);
    sockets.forEach((socket) => socket.open());
    await flush();

    expect(sockets).toHaveLength(2);
    expect(clients.every((client) => client.initialize.mock.calls.length === 1))
      .toBe(true);
    expect(ready.sort()).toEqual(["macbook", "mini"]);
    expect(statuses).toEqual(
      expect.arrayContaining([
        ["mini", "connecting"],
        ["mini", "online"],
        ["macbook", "connecting"],
        ["macbook", "online"],
      ]),
    );
    expect(manager.client("mini")).toBe(clients[0]);
    expect(manager.client("macbook")).toBe(clients[1]);
    manager.close();
  });

  it("为通知和请求保留来源后端及来源客户端", async () => {
    const socket = new FakeSocket();
    const client = new FakeClient();
    const notifications: Array<[string, RpcMessage, BackendClient]> = [];
    const requests: Array<[string, RpcMessage, BackendClient]> = [];
    const manager = new BackendConnectionManager({
      createSocket: () => socket,
      createClient: () => client,
      onNotification: (backendId, message, source) =>
        notifications.push([backendId, message, source]),
      onRequest: (backendId, message, source) =>
        requests.push([backendId, message, source]),
    });

    manager.sync([backend("mini", "http://192.168.100.8:4173")]);
    socket.open();
    await flush();
    client.emitNotification({ method: "turn/started", params: { turn: {} } });
    client.emitRequest({ id: 7, method: "item/tool/requestUserInput" });

    expect(notifications[0]).toEqual([
      "mini",
      { method: "turn/started", params: { turn: {} } },
      client,
    ]);
    expect(requests[0]).toEqual([
      "mini",
      { id: 7, method: "item/tool/requestUserInput" },
      client,
    ]);
    manager.close();
  });

  it("移除一个后端不会关闭其他后端连接", () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const manager = new BackendConnectionManager({
      createSocket: () => sockets.shift()!,
      createClient: () => new FakeClient(),
    });
    const mini = backend("mini", "http://192.168.100.8:4173");
    const macbook = backend("macbook", "http://192.168.100.35:4173");
    manager.sync([mini, macbook]);
    const miniSocket = manager.socket("mini") as FakeSocket;
    const macbookSocket = manager.socket("macbook") as FakeSocket;

    manager.sync([macbook]);

    expect(miniSocket.closed).toBe(true);
    expect(macbookSocket.closed).toBe(false);
    manager.close();
  });

  it("配置变化重连后忽略旧客户端迟到的事件", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const clients = [new FakeClient(), new FakeClient()];
    const received: string[] = [];
    const manager = new BackendConnectionManager({
      createSocket: () => sockets.shift()!,
      createClient: () => clients.shift()!,
      onNotification: (_backendId, message) =>
        received.push(String(message.method)),
    });
    const first = backend("mini", "http://192.168.100.8:4173", "old");
    manager.sync([first]);
    (manager.socket("mini") as FakeSocket).open();
    await flush();
    const oldClient = manager.client("mini") as FakeClient;

    manager.sync([{ ...first, token: "new" }]);
    (manager.socket("mini") as FakeSocket).open();
    await flush();
    const newClient = manager.client("mini") as FakeClient;
    oldClient.emitNotification({ method: "old/event" });
    newClient.emitNotification({ method: "new/event" });

    expect(received).toEqual(["new/event"]);
    manager.close();
  });

  it("等待重连期间修改配置会立即取消旧重试并使用新配置", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const manager = new BackendConnectionManager({
      createSocket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => new FakeClient(),
    });
    const first = backend("mini", "http://192.168.100.8:4173", "old");
    manager.sync([first]);
    sockets[0].close();

    manager.sync([{ ...first, token: "new" }]);

    expect(urls).toEqual([
      "ws://192.168.100.8:4173/ws?token=old",
      "ws://192.168.100.8:4173/ws?token=new",
    ]);
    vi.advanceTimersByTime(20_000);
    expect(urls).toHaveLength(2);
    manager.close();
    vi.useRealTimers();
  });

  it("正式连接 initialize 无响应时关闭半开连接并重试", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const clients: FakeClient[] = [];
    const statuses: Array<[string, string, string | undefined]> = [];
    const manager = new BackendConnectionManager({
      initializeTimeoutMs: 1_000,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => {
        const client = new FakeClient();
        client.initialize.mockImplementation(() => new Promise(() => {}));
        clients.push(client);
        return client;
      },
      onConnection: (backendId, status, error) =>
        statuses.push([backendId, status, error]),
    });

    manager.sync([backend("mini", "http://192.168.100.8:4173")]);
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sockets[0].closed).toBe(true);
    expect(statuses).toContainEqual([
      "mini",
      "offline",
      "设备 initialize 超时",
    ]);

    await vi.advanceTimersByTimeAsync(750);
    expect(sockets).toHaveLength(2);
    manager.close();
    vi.useRealTimers();
  });

  it("可以主动关闭疑似半开连接并立即创建新连接", async () => {
    const sockets: FakeSocket[] = [];
    const manager = new BackendConnectionManager({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => new FakeClient(),
    });
    manager.sync([backend("mini", "http://192.168.100.8:4173")]);
    sockets[0].open();
    await flush();

    manager.reconnect("mini");

    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(manager.socket("mini")).toBe(sockets[1]);
    manager.close();
  });

  it("主动重连可以替换永久停在 CONNECTING 的旧连接", () => {
    const sockets: FakeSocket[] = [];
    const manager = new BackendConnectionManager({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => new FakeClient(),
    });
    manager.sync([backend("mini", "http://192.168.100.8:4173")]);

    manager.reconnect("mini");

    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(manager.socket("mini")).toBe(sockets[1]);
    manager.close();
  });
});
