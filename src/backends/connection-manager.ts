import {
  AppServerClient,
  type RpcMessage,
} from "../app-server/client";
import type { ConnectionState } from "../ui/app-display";
import type { BackendConfig } from "./types";

export interface WebSocketLike {
  readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  close(code?: number, reason?: string): void;
}

export interface BackendClient {
  initialize(): Promise<unknown>;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  notify(method: string, params: unknown): void;
  respond(id: number | string, result: unknown): void;
  respondError(
    id: number | string,
    code: number,
    message: string,
    data?: unknown,
  ): void;
  onNotification(listener: (message: RpcMessage) => void): () => void;
  onRequest(listener: (message: RpcMessage) => void): () => void;
}

interface ConnectionEntry {
  config: BackendConfig;
  signature: string;
  generation: number;
  socket: WebSocketLike;
  client: BackendClient | null;
  retryAttempt: number;
}

interface BackendConnectionManagerOptions {
  initializeTimeoutMs?: number;
  createSocket?: (url: string, backend: BackendConfig) => WebSocketLike;
  createClient?: (
    socket: WebSocketLike,
    backend: BackendConfig,
  ) => BackendClient;
  onConnection?: (
    backendId: string,
    status: ConnectionState,
    error?: string,
  ) => void;
  onReady?: (backendId: string, client: BackendClient) => void;
  onNotification?: (
    backendId: string,
    message: RpcMessage,
    client: BackendClient,
  ) => void;
  onRequest?: (
    backendId: string,
    message: RpcMessage,
    client: BackendClient,
  ) => void;
}

function configSignature(config: BackendConfig) {
  return JSON.stringify({
    baseUrl: config.baseUrl,
    token: config.token,
    enabled: config.enabled,
  });
}

export function backendWebSocketUrl(config: BackendConfig) {
  const url = new URL(config.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  if (config.token) url.searchParams.set("token", config.token);
  return url.toString();
}

export class BackendConnectionManager {
  private readonly entries = new Map<string, ConnectionEntry>();
  private readonly desired = new Map<string, BackendConfig>();
  private readonly generations = new Map<string, number>();
  private readonly retryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly options: Required<
    Pick<BackendConnectionManagerOptions, "createSocket" | "createClient">
  > &
    BackendConnectionManagerOptions;
  private disposed = false;
  private readonly initializeTimeoutMs: number;

  constructor(options: BackendConnectionManagerOptions = {}) {
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? 10_000;
    this.options = {
      ...options,
      createSocket:
        options.createSocket ??
        ((url) => new WebSocket(url) as unknown as WebSocketLike),
      createClient:
        options.createClient ??
        ((socket) => new AppServerClient(socket as unknown as WebSocket)),
    };
  }

  sync(configs: BackendConfig[]) {
    if (this.disposed) return;
    const enabled = configs.filter((config) => config.enabled);
    const nextIds = new Set(enabled.map((config) => config.id));
    for (const backendId of this.desired.keys()) {
      if (!nextIds.has(backendId)) this.disconnect(backendId);
    }
    for (const config of enabled) {
      const signature = configSignature(config);
      const previousDesired = this.desired.get(config.id);
      this.desired.set(config.id, config);
      const current = this.entries.get(config.id);
      if (current?.signature === signature) continue;
      if (!current && this.retryTimers.has(config.id)) {
        if (
          previousDesired &&
          configSignature(previousDesired) === signature
        ) {
          continue;
        }
        clearTimeout(this.retryTimers.get(config.id)!);
        this.retryTimers.delete(config.id);
      }
      if (current) this.disconnect(config.id, false);
      this.desired.set(config.id, config);
      this.connect(config, 0);
    }
  }

  client(backendId: string) {
    return this.entries.get(backendId)?.client ?? null;
  }

  socket(backendId: string) {
    return this.entries.get(backendId)?.socket ?? null;
  }

  close() {
    if (this.disposed) return;
    this.disposed = true;
    this.desired.clear();
    for (const backendId of [...this.entries.keys()]) {
      this.disconnect(backendId);
    }
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  private current(backendId: string, generation: number) {
    const entry = this.entries.get(backendId);
    return entry?.generation === generation ? entry : null;
  }

  private connect(config: BackendConfig, retryAttempt: number) {
    if (this.disposed) return;
    const desired = this.desired.get(config.id);
    if (!desired || configSignature(desired) !== configSignature(config)) return;
    const generation = (this.generations.get(config.id) ?? 0) + 1;
    this.generations.set(config.id, generation);
    this.options.onConnection?.(config.id, "connecting");
    let socket: WebSocketLike;
    try {
      socket = this.options.createSocket(
        backendWebSocketUrl(config),
        config,
      );
    } catch (reason) {
      this.options.onConnection?.(
        config.id,
        "offline",
        reason instanceof Error ? reason.message : String(reason),
      );
      this.scheduleRetry(config, retryAttempt + 1);
      return;
    }
    const entry: ConnectionEntry = {
      config,
      signature: configSignature(config),
      generation,
      socket,
      client: null,
      retryAttempt,
    };
    this.entries.set(config.id, entry);

    socket.addEventListener("open", () => {
      void this.handleOpen(config.id, generation);
    });
    socket.addEventListener("close", () => {
      const current = this.current(config.id, generation);
      if (!current) return;
      this.entries.delete(config.id);
      this.options.onConnection?.(config.id, "offline");
      this.scheduleRetry(config, current.retryAttempt + 1);
    });
    socket.addEventListener("error", () => {
      const current = this.current(config.id, generation);
      if (!current) return;
      this.options.onConnection?.(
        config.id,
        "offline",
        "无法连接设备网关",
      );
    });
  }

  private async handleOpen(backendId: string, generation: number) {
    const entry = this.current(backendId, generation);
    if (!entry) return;
    const client = this.options.createClient(entry.socket, entry.config);
    entry.client = client;
    client.onNotification((message) => {
      const current = this.current(backendId, generation);
      if (current?.client !== client) return;
      this.options.onNotification?.(backendId, message, client);
    });
    client.onRequest((message) => {
      const current = this.current(backendId, generation);
      if (current?.client !== client) return;
      this.options.onRequest?.(backendId, message, client);
    });
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.initialize(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("设备 initialize 超时")),
              this.initializeTimeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      const current = this.current(backendId, generation);
      if (current?.client !== client) return;
      current.retryAttempt = 0;
      this.options.onConnection?.(backendId, "online");
      this.options.onReady?.(backendId, client);
    } catch (reason) {
      const current = this.current(backendId, generation);
      if (!current) return;
      this.options.onConnection?.(
        backendId,
        "offline",
        reason instanceof Error ? reason.message : String(reason),
      );
      current.socket.close();
    }
  }

  private scheduleRetry(config: BackendConfig, retryAttempt: number) {
    if (this.disposed) return;
    const desired = this.desired.get(config.id);
    if (!desired || configSignature(desired) !== configSignature(config)) return;
    const delay = Math.min(15_000, 750 * 2 ** Math.max(0, retryAttempt - 1));
    const timer = setTimeout(() => {
      this.retryTimers.delete(config.id);
      const latest = this.desired.get(config.id);
      if (
        latest &&
        configSignature(latest) === configSignature(config) &&
        !this.entries.has(config.id)
      ) {
        this.connect(latest, retryAttempt);
      }
    }, delay);
    this.retryTimers.set(config.id, timer);
  }

  private disconnect(backendId: string, removeDesired = true) {
    if (removeDesired) this.desired.delete(backendId);
    const retryTimer = this.retryTimers.get(backendId);
    if (retryTimer) clearTimeout(retryTimer);
    this.retryTimers.delete(backendId);
    const entry = this.entries.get(backendId);
    if (!entry) return;
    this.entries.delete(backendId);
    entry.socket.close(1000, "backend removed");
  }
}
