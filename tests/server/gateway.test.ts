import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("未携带口令仍返回前端页面、静态资源和路由回退", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "codex-mobile-gateway-"));
    await mkdir(join(staticDir, "assets"));
    await writeFile(join(staticDir, "index.html"), "<main>Codex Mobile</main>");
    await writeFile(join(staticDir, "assets", "app.js"), "window.app = true;");
    cleanups.push(() => rm(staticDir, { recursive: true, force: true }));

    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir,
      accessToken: "expected-token",
    });
    cleanups.push(async () => gateway.close());

    const root = await fetch(`http://127.0.0.1:${gateway.port}/`);
    const asset = await fetch(
      `http://127.0.0.1:${gateway.port}/assets/app.js`,
    );
    const route = await fetch(
      `http://127.0.0.1:${gateway.port}/conversation/thread-1`,
    );

    expect(root.status).toBe(200);
    expect(await root.text()).toContain("Codex Mobile");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("window.app = true;");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("Codex Mobile");
  });

  it("错误口令只能加载前端壳，正确口令 Cookie 才能访问 API", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "codex-mobile-gateway-"));
    await writeFile(join(staticDir, "index.html"), "<main>Codex Mobile</main>");
    cleanups.push(() => rm(staticDir, { recursive: true, force: true }));

    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir,
      accessToken: "expected-token",
    });
    cleanups.push(async () => gateway.close());

    const wrongPage = await fetch(
      `http://127.0.0.1:${gateway.port}/?token=wrong-token`,
    );
    const wrongApi = await fetch(
      `http://127.0.0.1:${gateway.port}/api/status?token=wrong-token`,
    );
    const authenticatedPage = await fetch(
      `http://127.0.0.1:${gateway.port}/?token=expected-token`,
    );
    const cookie = authenticatedPage.headers.get("set-cookie")?.split(";")[0];
    const cookieApi = await fetch(
      `http://127.0.0.1:${gateway.port}/api/status`,
      { headers: { Cookie: cookie ?? "" } },
    );
    const unknownApi = await fetch(
      `http://127.0.0.1:${gateway.port}/api/unknown?token=expected-token`,
    );

    expect(wrongPage.status).toBe(200);
    expect(wrongPage.headers.get("set-cookie")).toBeNull();
    expect(wrongApi.status).toBe(401);
    expect(cookie).toBe("codex_mobile_token=expected-token");
    expect(cookieApi.status).toBe(200);
    expect(unknownApi.status).toBe(404);
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

  it("鉴权后把任意文件上传到受控目录并返回机器路径", async () => {
    const uploadDir = await mkdtemp(join(tmpdir(), "codex-mobile-file-"));
    cleanups.push(() => rm(uploadDir, { recursive: true, force: true }));
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "upload-token",
      uploadDir,
    });
    cleanups.push(async () => gateway.close());

    const denied = await fetch(
      `http://127.0.0.1:${gateway.port}/api/uploads/file`,
      { method: "POST", body: "pdf" },
    );
    const uploaded = await fetch(
      `http://127.0.0.1:${gateway.port}/api/uploads/file?token=upload-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
          "x-codex-file-name": encodeURIComponent("需求文档.pdf"),
        },
        body: "pdf",
      },
    );

    expect(denied.status).toBe(401);
    expect(uploaded.status).toBe(201);
    const result = (await uploaded.json()) as { path: string; name: string; size: number };
    expect(result.name).toBe("需求文档.pdf");
    expect(result.size).toBe(3);
    expect(result.path.startsWith(uploadDir)).toBe(true);
    expect(result.path.endsWith(".pdf")).toBe(true);
    expect(await readFile(result.path, "utf8")).toBe("pdf");
  });

  it("控制接口支持预检并允许任意跨源请求", async () => {
    const gateway = await createGateway({
      host: "127.0.0.1",
      port: 0,
      mode: "external",
      upstreamUrl: "ws://127.0.0.1:9",
      staticDir: null,
      accessToken: "host-token",
    });
    cleanups.push(async () => gateway.close());
    const url = `http://127.0.0.1:${gateway.port}/api/host?token=host-token`;

    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: "http://frontend.local:4173" },
    });
    const crossOrigin = await fetch(url, {
      headers: { Origin: "http://attacker.local:4173" },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "GET",
    );
    expect(crossOrigin.status).toBe(200);
    expect(crossOrigin.headers.get("access-control-allow-origin")).toBe(
      "http://attacker.local:4173",
    );
  });

  it("WebSocket 接受任意浏览器 Origin", async () => {
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
      `ws://127.0.0.1:${gateway.port}/ws?token=expected-token`,
      { origin: "http://attacker.local:4173" },
    );
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.close();
  });
});
