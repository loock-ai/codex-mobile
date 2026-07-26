export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type NotificationListener = (message: RpcMessage) => void;
type RequestListener = (message: RpcMessage) => void;

export class AppServerClient {
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private notificationListeners = new Set<NotificationListener>();
  private requestListeners = new Set<RequestListener>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => {
      const error = new Error("与 app-server 的连接已断开");
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    });
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: { name: "codex-mobile-web", title: "Codex Mobile Web", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    return result;
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    this.send({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ method, params });
  }

  respond(id: number | string, result: unknown) {
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
      if (message.error) waiter.reject(new Error(message.error.message));
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
