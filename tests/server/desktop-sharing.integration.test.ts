// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import WebSocket from "ws";
import { createGateway, type Gateway } from "../../server/gateway.js";

const executable = process.env.CODEX_DESKTOP_TEST_BINARY;
let child: ChildProcess | undefined;
let provider: Server | undefined;
let gateway: Gateway | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await gateway?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child?.kill("SIGKILL"), 1000);
    await stopped;
    clearTimeout(timeout);
  }
  if (provider) { provider.closeAllConnections(); await new Promise<void>((resolve) => provider!.close(() => resolve())); }
});

it.skipIf(!executable)("Desktop 共享服务支持网关双向发送、运行中引导和网关重启恢复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-desktop-share-test-"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const url = `ws://127.0.0.1:${port}`;
  child = spawn(executable!, ["app-server", "--listen", url], {
    env: { PATH: process.env.PATH, HOME: directory, CODEX_HOME: directory },
    stdio: "ignore",
  });
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error("测试服务提前退出");
    try {
      if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) { ready = true; break; }
    } catch { /* 等待测试服务监听 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(ready).toBe(true);
  gateway = await createGateway({ host: "127.0.0.1", port: 0, mode: "external", upstreamUrl: url, staticDir: null, accessToken: "fixture-token" });
  let replies = 0;
  let holdNext = false;
  let releaseReply: (() => void) | undefined;
  provider = createHttpServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const reply = () => {
      const id = `resp_${++replies}`, itemId = `msg_${replies}`, text = `共享回复 ${replies}`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, value: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      const item = { id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
      event("response.created", { response: { id, status: "in_progress", output: [] } });
      event("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", content: [] } });
      event("response.content_part.added", { item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      event("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta: text });
      event("response.output_item.done", { output_index: 0, item });
      event("response.completed", { response: { id, status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      response.end();
      };
      if (holdNext) { holdNext = false; releaseReply = reply; }
      else reply();
    });
  });
  await new Promise<void>((resolve) => provider!.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  async function connect(name: string, endpoint = url) {
    const socket = new WebSocket(endpoint);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    let sequence = 0;
    const events: any[] = [];
    socket.on("message", (data) => { const event = JSON.parse(String(data)); if (event.method) events.push(event); });
    function request(method: string, params: unknown): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { socket.off("message", receive); reject(new Error(`${method} 超时`)); }, 5000);
        function receive(data: WebSocket.RawData) {
          const message = JSON.parse(String(data));
          if (message.id !== id) return;
          clearTimeout(timer);
          socket.off("message", receive);
          if (message.error) reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result);
        }
        socket.on("message", receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    await request("initialize", { clientInfo: { name, version: "1" }, capabilities: { experimentalApi: true } });
    socket.send(JSON.stringify({ method: "initialized", params: {} }));
    return Object.assign(request, { events });
  }
  const a = await connect("desktop-sharing-a");
  const b = await connect("desktop-sharing-b", `ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`);
  const start = await a("thread/start", {
    cwd: directory, model: "fixture", modelProvider: "sharing-fixture", excludeTurns: true,
    config: { "model_providers.sharing-fixture": {
      name: "Offline sharing fixture", base_url: providerUrl, wire_api: "responses",
      request_max_retries: 0, stream_max_retries: 0,
    } },
  });
  const threadId = start.thread.id;
  const first = await a("turn/start", { threadId, input: [{ type: "text", text: "offline transport fixture" }] });
  async function completed(client: typeof a, turnId: string) {
    await expect.poll(() => client.events.find((event) => event.method === "turn/completed" && event.params.turn.id === turnId), { timeout: 6000 }).toBeTruthy();
    expect(client.events.find((event) => event.method === "turn/completed" && event.params.turn.id === turnId).params.turn.status).toBe("completed");
  }
  await completed(a, first.turn.id);
  const resumed = await b("thread/resume", { threadId, excludeTurns: true, initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" } });
  expect(resumed.thread.id).toBe(threadId);
  expect(Array.isArray(resumed.initialTurnsPage.data)).toBe(true);
  expect((await a("thread/resume", { threadId, excludeTurns: true, initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" } })).thread.id).toBe(threadId);
  const second = await b("turn/start", { threadId, input: [{ type: "text", text: "web sends" }] });
  await Promise.all([completed(a, second.turn.id), completed(b, second.turn.id)]);
  const third = await a("turn/start", { threadId, input: [{ type: "text", text: "desktop sends" }] });
  await Promise.all([completed(a, third.turn.id), completed(b, third.turn.id)]);
  for (const client of [a, b]) {
    expect(client.events.some((event) => event.method === "item/agentMessage/delta" && event.params.delta.includes("共享回复"))).toBe(true);
  }
  expect(replies).toBe(3);
  holdNext = true;
  const fourth = await a("turn/start", { threadId, input: [{ type: "text", text: "wait for steering" }] });
  await expect.poll(() => releaseReply, { timeout: 5000 }).toBeTruthy();
  const steered = await b("turn/steer", {
    threadId, expectedTurnId: fourth.turn.id,
    input: [{ type: "text", text: "web steering while desktop runs" }],
  });
  expect(steered.turnId).toBe(fourth.turn.id);
  releaseReply!();
  await Promise.all([completed(a, fourth.turn.id), completed(b, fourth.turn.id)]);
  await gateway.close();
  expect(child.exitCode).toBeNull();
  expect(child.signalCode).toBeNull();
  gateway = await createGateway({ host: "127.0.0.1", port: 0, mode: "external", upstreamUrl: url, staticDir: null, accessToken: "fixture-token" });
  const reconnected = await connect("desktop-sharing-reconnected", `ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`);
  const history = await reconnected("thread/resume", { threadId, excludeTurns: true, initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" } });
  expect(JSON.stringify(history.initialTurnsPage.data)).toContain("web steering while desktop runs");
  const fifth = await reconnected("turn/start", { threadId, input: [{ type: "text", text: "continue after gateway restart" }] });
  await Promise.all([completed(a, fifth.turn.id), completed(reconnected, fifth.turn.id)]);
}, 20000);
