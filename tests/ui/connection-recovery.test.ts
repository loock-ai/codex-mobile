import { describe, expect, it, vi } from "vitest";
import {
  bindConnectionRecovery,
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

  it("健康连接通过探测时不会重连", async () => {
    const client = {
      request: vi.fn(async () => ({ rateLimits: {} })),
    };
    const reconnect = vi.fn();

    await recoverBackendConnection(
      client as never,
      reconnect,
    );

    expect(client.request).toHaveBeenCalledWith(
      "thread/list",
      { limit: 1, sortKey: "updated_at" },
      { timeoutMs: 2_500 },
    );
    expect(reconnect).not.toHaveBeenCalled();
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
});
