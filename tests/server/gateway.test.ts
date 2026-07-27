import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createGateway } from "../../server/gateway.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("透明网关", () => {
  it("原样转发客户端和 app-server 的文本消息", async () => {
    const upstreamHttp = createServer();
    const upstream = new WebSocketServer({ server: upstreamHttp });
    await new Promise<void>((resolve) =>
      upstreamHttp.listen(0, "127.0.0.1", resolve),
    );
    const upstreamPort = (upstreamHttp.address() as { port: number }).port;
    const upstreamUrl = `ws://127.0.0.1:${upstreamPort}`;

    upstream.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        socket.send(data, { binary: isBinary });
      });
    });

    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl,
      staticDir: null,
    });
    cleanups.push(async () => gateway.close());
    cleanups.push(
      async () =>
        new Promise<void>((resolve) => upstreamHttp.close(() => resolve())),
    );

    const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const payload = JSON.stringify({
      id: 41,
      method: "thread/list",
      params: { limit: 5 },
    });
    const echoed = new Promise<string>((resolve) =>
      client.on("message", (data) => resolve(data.toString())),
    );
    client.send(payload);

    expect(await echoed).toBe(payload);
    client.close();
  });

  it("拒绝错误的访问口令", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "expected-token",
    });
    cleanups.push(async () => gateway.close());

    const client = new WebSocket(
      `ws://127.0.0.1:${gateway.port}/ws?token=wrong-token`,
    );
    const status = await new Promise<number>((resolve) =>
      client.once("unexpected-response", (_request, response) =>
        resolve(response.statusCode ?? 0),
      ),
    );

    expect(status).toBe(401);
  });

  it("访问口令同时保护 HTTP 状态接口", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "expected-token",
    });
    cleanups.push(async () => gateway.close());

    const denied = await fetch(`http://127.0.0.1:${gateway.port}/api/status`);
    const allowed = await fetch(
      `http://127.0.0.1:${gateway.port}/api/status?token=expected-token`,
    );
    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
  });

  it("项目接口返回 Codex 配置中的目录", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "project-token",
      readProjectDirectories: async () => ["/workspace/one", "/workspace/two"],
    });
    cleanups.push(async () => gateway.close());

    const response = await fetch(
      `http://127.0.0.1:${gateway.port}/api/projects?token=project-token`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: ["/workspace/one", "/workspace/two"],
    });
  });

  it("设备信息接口返回受控身份和 app-server 就绪状态", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "host-token",
      hostId: "mac-mini",
      displayName: "Mac mini",
      hostname: "mac-mini.local",
      gatewayVersion: "0.2.0",
      appServerReady: async () => false,
      allowedOrigins: ["http://frontend.local:4173"],
    });
    cleanups.push(async () => gateway.close());

    const response = await fetch(
      `http://127.0.0.1:${gateway.port}/api/host?token=host-token`,
      { headers: { Origin: "http://frontend.local:4173" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://frontend.local:4173",
    );
    expect(await response.json()).toEqual({
      hostId: "mac-mini",
      displayName: "Mac mini",
      hostname: "mac-mini.local",
      gatewayVersion: "0.2.0",
      appServerReady: false,
    });
  });

  it("控制接口支持预检并拒绝未允许的跨源请求", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "host-token",
      allowedOrigins: ["http://frontend.local:4173"],
    });
    cleanups.push(async () => gateway.close());
    const url = `http://127.0.0.1:${gateway.port}/api/host?token=host-token`;

    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: "http://frontend.local:4173" },
    });
    const rejected = await fetch(url, {
      headers: { Origin: "http://attacker.local:4173" },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "GET",
    );
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("WebSocket 只接受允许的浏览器 Origin", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      allowedOrigins: ["http://frontend.local:4173"],
    });
    cleanups.push(async () => gateway.close());

    const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws`, {
      origin: "http://attacker.local:4173",
    });
    const status = await new Promise<number>((resolve) =>
      client.once("unexpected-response", (_request, response) =>
        resolve(response.statusCode ?? 0),
      ),
    );

    expect(status).toBe(403);
  });
});
