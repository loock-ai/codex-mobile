import { AppServerClient } from "../app-server/client";
import { backendWebSocketUrl } from "./connection-manager";
import type { BackendConfig } from "./types";

export interface GatewayHostInfo {
  hostId: string;
  displayName: string;
  hostname: string;
  gatewayVersion: string;
  appServerReady: boolean;
}

function withToken(baseUrl: string, path: string, token: string) {
  const url = new URL(path, `${baseUrl}/`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function initializeSocket(
  url: string,
  timeoutMs: number,
) {
  const socket = new WebSocket(url);
  try {
    await withTimeout(
      (async () => {
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener("open", () => resolve(), { once: true });
          socket.addEventListener(
            "error",
            () => reject(new Error("无法连接设备 WebSocket")),
            { once: true },
          );
          socket.addEventListener(
            "close",
            () => reject(new Error("设备 WebSocket 已关闭")),
            { once: true },
          );
        });
        const client = new AppServerClient(socket);
        await client.initialize();
      })(),
      timeoutMs,
      "WebSocket initialize 超时",
    );
  } finally {
    socket.close();
  }
}

interface ProbeDependencies {
  timeoutMs?: number;
  fetchHost?: (
    input: string,
    init: RequestInit,
  ) => Promise<Response>;
  initializeWebSocket?: (url: string) => Promise<void>;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function fetchBackendHostInfo(
  config: BackendConfig,
  dependencies: Pick<ProbeDependencies, "timeoutMs" | "fetchHost"> = {},
): Promise<GatewayHostInfo> {
  const timeoutMs = dependencies.timeoutMs ?? 6_000;
  const fetchHost = dependencies.fetchHost ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchHost(
      withToken(config.baseUrl, "/api/host", config.token),
      {
        method: "GET",
        mode: "cors",
        signal: controller.signal,
      },
    );
  } catch (reason) {
    if (controller.signal.aborted) throw new Error("设备探测超时");
    throw reason;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("访问口令不正确");
    if (response.status === 403) throw new Error("当前前端地址未被设备允许");
    throw new Error(`设备网关返回 ${response.status}`);
  }
  const info = (await response.json()) as GatewayHostInfo;
  if (
    !info ||
    typeof info.hostId !== "string" ||
    typeof info.displayName !== "string"
  ) {
    throw new Error("设备身份响应无效");
  }
  if (!info.appServerReady) {
    throw new Error("设备 app-server 尚未就绪");
  }
  return info;
}

export async function probeBackend(
  config: BackendConfig,
  dependencies: ProbeDependencies = {},
): Promise<GatewayHostInfo> {
  const timeoutMs = dependencies.timeoutMs ?? 6_000;
  const info = await fetchBackendHostInfo(config, dependencies);
  const initializeWebSocket =
    dependencies.initializeWebSocket ??
    ((url: string) => initializeSocket(url, timeoutMs));
  await withTimeout(
    initializeWebSocket(backendWebSocketUrl(config)),
    timeoutMs,
    "WebSocket initialize 超时",
  );
  return info;
}
