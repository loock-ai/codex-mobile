import { describe, expect, it, vi } from "vitest";
import { probeBackend } from "../../src/backends/probe";
import type { BackendConfig } from "../../src/backends/types";

const backend: BackendConfig = {
  id: "mini",
  name: "Mac mini",
  baseUrl: "http://192.168.100.8:4173",
  token: "a b",
  enabled: true,
  order: 0,
};

describe("设备网关探测", () => {
  it("验证控制面后再完成一次 WebSocket initialize", async () => {
    const fetchHost = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hostId: "mini",
          displayName: "Mac mini",
          hostname: "mac-mini.local",
          gatewayVersion: "0.2.0",
          appServerReady: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const initializeWebSocket = vi.fn(async () => undefined);

    await expect(
      probeBackend(backend, { fetchHost, initializeWebSocket }),
    ).resolves.toMatchObject({
      hostId: "mini",
      appServerReady: true,
    });
    expect(fetchHost).toHaveBeenCalledWith(
      "http://192.168.100.8:4173/api/host?token=a+b",
      expect.objectContaining({ method: "GET" }),
    );
    expect(initializeWebSocket).toHaveBeenCalledWith(
      "ws://192.168.100.8:4173/ws?token=a+b",
    );
  });

  it("app-server 未就绪时不尝试建立业务连接", async () => {
    const fetchHost = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hostId: "mini",
          displayName: "Mac mini",
          hostname: "mac-mini.local",
          gatewayVersion: "0.2.0",
          appServerReady: false,
        }),
        { status: 200 },
      ),
    );
    const initializeWebSocket = vi.fn(async () => undefined);

    await expect(
      probeBackend(backend, { fetchHost, initializeWebSocket }),
    ).rejects.toThrow("app-server 尚未就绪");
    expect(initializeWebSocket).not.toHaveBeenCalled();
  });

  it("WebSocket 打开后 initialize 无响应也会超时", async () => {
    const fetchHost = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hostId: "mini",
          displayName: "Mac mini",
          hostname: "mac-mini.local",
          gatewayVersion: "0.2.0",
          appServerReady: true,
        }),
        { status: 200 },
      ),
    );

    await expect(
      probeBackend(backend, {
        timeoutMs: 10,
        fetchHost,
        initializeWebSocket: () => new Promise<void>(() => undefined),
      }),
    ).rejects.toThrow("initialize 超时");
  });
});
