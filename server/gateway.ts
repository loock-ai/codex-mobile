import { createServer, type Server } from "node:http";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import WebSocket, { WebSocketServer } from "ws";

export interface GatewayOptions {
  host: string;
  port: number;
  mode: "managed" | "external";
  upstreamUrl: string;
  staticDir: string | null;
  accessToken?: string;
  hostId?: string;
  displayName?: string;
  hostname?: string;
  gatewayVersion?: string;
  appServerReady?: () => Promise<boolean>;
  readProjectDirectories?: () => Promise<string[]>;
  uploadDir?: string;
}

export interface Gateway {
  port: number;
  close(): Promise<void>;
}

function sendableCloseCode(code: number) {
  return (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  );
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function authorized(url: URL, expected?: string, cookie?: string) {
  return (
    !expected ||
    url.searchParams.get("token") === expected ||
    cookie?.split(";").some((part) => part.trim() === `codex_mobile_token=${encodeURIComponent(expected)}`)
  );
}

function applyCors(
  response: import("node:http").ServerResponse,
  origin: string | undefined,
) {
  if (!origin) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, x-codex-file-name",
  );
  response.setHeader("vary", "Origin");
}

export async function createGateway(options: GatewayOptions): Promise<Gateway> {
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    const origin = request.headers.origin;
    const controlRequest = [
      "/api/status",
      "/api/host",
      "/api/projects",
      "/api/uploads/file",
    ].includes(url.pathname);
    const apiRequest =
      url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (controlRequest) {
      applyCors(response, origin);
    }
    if (
      apiRequest &&
      !authorized(url, options.accessToken, request.headers.cookie)
    ) {
      response.statusCode = 401;
      response.end("Unauthorized");
      return;
    }
    if (options.accessToken && url.searchParams.get("token") === options.accessToken) {
      response.setHeader(
        "set-cookie",
        `codex_mobile_token=${encodeURIComponent(options.accessToken)}; Path=/; HttpOnly; SameSite=Strict`,
      );
    }
    if (controlRequest && request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (url.pathname === "/api/host") {
      let appServerReady = false;
      try {
        appServerReady = options.appServerReady
          ? await options.appServerReady()
          : true;
      } catch {
        appServerReady = false;
      }
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          hostId: options.hostId ?? "local",
          displayName:
            options.displayName ?? options.hostname ?? options.hostId ?? "Codex",
          hostname: options.hostname ?? "localhost",
          gatewayVersion: options.gatewayVersion ?? "0.1.0",
          appServerReady,
        }),
      );
      return;
    }
    if (url.pathname === "/api/status") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ mode: options.mode, upstreamUrl: options.upstreamUrl }));
      return;
    }
    if (url.pathname === "/api/projects") {
      try {
        const projects = options.readProjectDirectories
          ? await options.readProjectDirectories()
          : [];
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ projects }));
      } catch {
        response.statusCode = 500;
        response.end("无法读取 Codex 本地项目");
      }
      return;
    }
    if (url.pathname === "/api/uploads/file" && request.method === "POST") {
      const type = String(request.headers["content-type"] ?? "").split(";", 1)[0];
      if (!options.uploadDir) {
        response.statusCode = 503;
        response.end("Upload directory unavailable");
        return;
      }
      const declaredSize = Number(request.headers["content-length"] ?? 0);
      const maxBytes = 100 * 1024 * 1024;
      if (declaredSize > maxBytes) {
        response.statusCode = 413;
        response.end("File exceeds 100 MB");
        return;
      }
      const rawName = Array.isArray(request.headers["x-codex-file-name"])
        ? request.headers["x-codex-file-name"][0]
        : request.headers["x-codex-file-name"];
      let name = "attachment";
      if (rawName) {
        try {
          name = decodeURIComponent(rawName);
        } catch {
          name = rawName;
        }
      }
      name = name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240) || "attachment";
      const extension = extname(name)
        .slice(0, 20)
        .replace(/[^.a-zA-Z0-9_-]/g, "");
      try {
        await mkdir(options.uploadDir, { recursive: true });
      } catch {
        response.statusCode = 500;
        response.end("Unable to prepare upload directory");
        return;
      }
      const filePath = join(options.uploadDir, `${Date.now()}-${randomUUID()}${extension}`);
      let file;
      try {
        file = await open(filePath, "wx");
      } catch {
        response.statusCode = 500;
        response.end("Unable to create upload file");
        return;
      }
      let size = 0;
      try {
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > maxBytes) throw new Error("FILE_TOO_LARGE");
          await file.write(buffer);
        }
      } catch (error) {
        await file.close();
        await rm(filePath, { force: true });
        response.statusCode = error instanceof Error && error.message === "FILE_TOO_LARGE" ? 413 : 400;
        response.end("Unable to upload file");
        return;
      }
      await file.close();
      if (!size) {
        await rm(filePath, { force: true });
        response.statusCode = 400;
        response.end("File is empty");
        return;
      }
      response.statusCode = 201;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ path: filePath, name, type, size }));
      return;
    }
    if (apiRequest) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    if (!options.staticDir) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = join(options.staticDir, safePath);
    try {
      const body = await readFile(filePath);
      response.setHeader("content-type", contentTypes[extname(filePath)] ?? "application/octet-stream");
      response.end(body);
    } catch {
      filePath = join(options.staticDir, "index.html");
      try {
        response.setHeader("content-type", contentTypes[".html"]);
        response.end(await readFile(filePath));
      } catch {
        response.statusCode = 404;
        response.end("Not found");
      }
    }
  });

  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!authorized(url, options.accessToken, request.headers.cookie)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });

  wss.on("connection", (client) => {
    sockets.add(client);
    const upstream = new WebSocket(options.upstreamUrl);
    sockets.add(upstream);
    const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
    let pendingBytes = 0;
    const maxPendingBytes = 1024 * 1024;

    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) {
        pendingBytes +=
          typeof data === "string"
            ? Buffer.byteLength(data)
            : data instanceof ArrayBuffer
              ? data.byteLength
              : Array.isArray(data)
                ? data.reduce((total, part) => total + part.byteLength, 0)
                : data.byteLength;
        if (pendingBytes > maxPendingBytes) {
          client.close(1009, "pending messages exceeded limit");
          upstream.terminate();
          return;
        }
        pending.push({ data, binary: isBinary });
      }
    });
    upstream.on("open", () => {
      for (const message of pending.splice(0)) upstream.send(message.data, { binary: message.binary });
      pendingBytes = 0;
    });
    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on("error", () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, "app-server unavailable");
    });
    client.on("close", (code, reason) => {
      if (upstream.readyState === WebSocket.OPEN) {
        if (sendableCloseCode(code)) upstream.close(code, reason);
        else upstream.terminate();
      }
      else upstream.terminate();
    });
    upstream.on("close", (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        if (sendableCloseCode(code)) client.close(code, reason);
        else client.close(1011, "app-server disconnected");
      }
    });
    const forget = (socket: WebSocket) => () => sockets.delete(socket);
    client.on("close", forget(client));
    upstream.on("close", forget(upstream));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法读取网关端口");

  return {
    port: address.port,
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
