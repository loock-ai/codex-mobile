import { t } from "../i18n";

export interface RpcMessage {
  sequence?: number;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type NotificationListener = (message: RpcMessage) => void;
type RequestListener = (message: RpcMessage) => void;

interface PendingRequest {
  write?: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AppServerClientOptions {
  requestTimeoutMs?: number;
  desktopHostId?: string;
}

export interface AppServerRequestOptions {
  timeoutMs?: number;
}

export class AppServerClient {
  backend: "app-server" | "desktop-cdp" | "desktop-control" = "app-server";
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private notificationListeners = new Set<NotificationListener>();
  private requestListeners = new Set<RequestListener>();
  private readonly requestTimeoutMs: number;
  private readonly desktopHostId?: string;

  constructor(
    private readonly socket: WebSocket,
    options: AppServerClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.desktopHostId = options.desktopHostId;
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => {
      const error = new Error(t("与 app-server 的连接已断开"));
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(waiter.write ? Object.assign(new Error('桌面操作结果未确认，请先核对会话，避免重复发送'),{code:'ACTION_WRITE_UNKNOWN'}) : error);
      }
      this.pending.clear();
    });
  }

  async initialize() {
    const result = await this.request<{ backend?: string; connected?: boolean }>("initialize", {
      ...(this.desktopHostId?{hostId:this.desktopHostId}:{}),
      clientInfo: { name: "codex-mobile-web", title: "Codex Mobile Web", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    });
    this.backend = result?.backend === 'desktop-control' ? 'desktop-control' : result?.backend === "desktop-cdp" ? "desktop-cdp" : "app-server";
    if(this.backend==='desktop-control'&&result.connected===false)throw new Error('桌面控制通道已断开，请重启控制服务');
    this.notify("initialized", {});
    return result;
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    options: AppServerRequestOptions = {},
  ): Promise<T> {
    const id = this.nextId++;
    const write=this.backend==='desktop-control'&&['thread/start','thread/resume','turn/start','turn/steer','turn/interrupt','desktop/approval/respond'].includes(method);
    return new Promise<T>((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error(t("与 app-server 的连接不可用")));
        return;
      }
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(write ? Object.assign(new Error('桌面操作结果未确认，请先核对会话，避免重复发送'),{code:'ACTION_WRITE_UNKNOWN'}) : new Error(t("{method} 请求超时", { method })));
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.close(4000, "request timeout");
        }
      }, options.timeoutMs ?? this.requestTimeoutMs);
      const pending: PendingRequest = {
        write,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      };
      this.pending.set(id, pending);
      try {
        this.send({ id, method, params });
      } catch (reason) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(reason);
      }
    });
  }

  notify(method: string, params: unknown) {
    this.send({ method, params });
  }

  async respond(id: number | string, result: unknown) {
    if(this.backend==='desktop-control'){await this.request('desktop/approval/respond',{approvalId:id,result});return;}
    this.send({ id, result });
  }

  respondError(id: number | string, code: number, message: string, data?: unknown) {
    this.send({ id, error: { code, message, data } });
  }

  onNotification(listener: NotificationListener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(listener: RequestListener) {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  private send(message: RpcMessage) {
    this.socket.send(JSON.stringify(message));
  }

  private receive(raw: string) {
    let message: RpcMessage;
    try {
      message = JSON.parse(raw) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message),{code:(message.error.data as {code?:string})?.code??message.error.code}));
      else waiter.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      for (const listener of this.requestListeners) listener(message);
      return;
    }
    if (message.method) {
      for (const listener of this.notificationListeners) listener(message);
    }
  }
}
