import { describe, expect, it, vi } from "vitest";
import {
  bindConnectionRecovery,
  reconnectAndWaitUntilReady,
  recoverBackendConnection,
} from "../../src/backends/connection-recovery";

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

describe("App 前后台连接恢复", () => {
  it("进入后台再回到前台时主动重连一次", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new EventTarget();
    const reconnect = vi.fn();
    const unbind = bindConnectionRecovery({
      documentTarget,
      windowTarget,
      reconnect,
    });

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(reconnect).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("连续的恢复事件只执行一次连接恢复", async () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new EventTarget();
    const reconnect = vi.fn();
    const unbind = bindConnectionRecovery({
      documentTarget,
      windowTarget,
      reconnect,
    });

    windowTarget.dispatchEvent(new Event("online"));
    const pageShow = new Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    windowTarget.dispatchEvent(pageShow);

    expect(reconnect).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    unbind();
  });

  it("普通首次 pageshow 不会误触发重连", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new EventTarget();
    const reconnect = vi.fn();
    const unbind = bindConnectionRecovery({
      documentTarget,
      windowTarget,
      reconnect,
    });

    windowTarget.dispatchEvent(new Event("pageshow"));

    expect(reconnect).not.toHaveBeenCalled();
    unbind();
  });

  it("解绑后不再响应生命周期事件", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new EventTarget();
    const reconnect = vi.fn();
    const unbind = bindConnectionRecovery({
      documentTarget,
      windowTarget,
      reconnect,
    });
    unbind();

    windowTarget.dispatchEvent(new Event("online"));
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("健康连接通过探测时增量对账当前会话且不会重连", async () => {
    const client = {
      request: vi.fn(async () => ({ rateLimits: {} })),
    };
    const reconnect = vi.fn();
    const reconcile = vi.fn(async () => undefined);

    await recoverBackendConnection(
      client as never,
      reconnect,
      reconcile,
    );

    expect(client.request).toHaveBeenCalledWith(
      "thread/list",
      { limit: 1, sortKey: "updated_at" },
      { timeoutMs: 2_500 },
    );
    expect(reconnect).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledWith(client);
  });

  it("探测失败或当前没有客户端时立即重连", async () => {
    const reconnect = vi.fn();
    const failingClient = {
      request: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };

    await recoverBackendConnection(failingClient as never, reconnect);
    await recoverBackendConnection(null, reconnect);

    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it("健康探测成功但增量对账失败时不拆掉连接", async () => {
    const client = {
      request: vi.fn(async () => ({ data: [] })),
    };
    const reconnect = vi.fn();

    await recoverBackendConnection(
      client as never,
      reconnect,
      async () => {
        throw new Error("snapshot failed");
      },
    );

    expect(reconnect).not.toHaveBeenCalled();
  });

  it("重连任务保持进行中直到新客户端初始化完成", async () => {
    let ready = false;
    const reconnect = vi.fn();
    const wait = vi.fn(async () => {
      ready = true;
    });

    await reconnectAndWaitUntilReady(
      reconnect,
      () => ready,
      wait,
    );

    expect(reconnect).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
  });
});
