import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { open } from "node:fs/promises";

export interface RuntimeConfig {
  mode: "managed" | "external";
  upstreamUrl: string;
  upstreamPort: number;
}

export interface GatewayRuntimeConfig {
  hostId: string;
  displayName: string;
  hostname: string;
  serveStatic: boolean;
}

export function resolveGatewayRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
  hostname = "localhost",
): GatewayRuntimeConfig {
  return {
    hostId: environment.CODEX_MOBILE_HOST_ID?.trim() || hostname,
    displayName: environment.CODEX_MOBILE_HOST_NAME?.trim() || hostname,
    hostname,
    serveStatic: environment.CODEX_MOBILE_SERVE_STATIC !== "false",
  };
}

export function appServerCommand(port: number) {
  return [
    "app-server",
    "--enable",
    "realtime_conversation",
    "--listen",
    `ws://127.0.0.1:${port}`,
  ];
}

export function appServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith("CODEX_MOBILE_"),
    ),
  );
}

export function assertGatewaySecurity(
  host: string,
  accessToken: string | undefined,
) {
  if (["127.0.0.1", "::1", "localhost"].includes(host)) return;
  if (!accessToken) {
    throw new Error("非回环监听必须配置 CODEX_MOBILE_TOKEN 访问口令");
  }
}

export function resolveRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  if (environment.CODEX_APP_SERVER_MODE === "desktop") {
    const address = environment.CODEX_APP_SERVER_WS_URL?.trim();
    if (!address) throw new Error("Desktop 模式必须配置 CODEX_APP_SERVER_WS_URL，共享 Desktop 的服务地址");
    let endpoint: URL;
    try {
      endpoint = new URL(address);
    } catch {
      throw new Error("Desktop 模式需要有效的本机 WebSocket 地址");
    }
    if (!["ws:", "wss:"].includes(endpoint.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
        endpoint.username || endpoint.password || endpoint.hash) {
      throw new Error("Desktop 模式需要有效的本机 WebSocket 地址");
    }
    return {
      mode: "external",
      upstreamUrl: address,
      upstreamPort: Number(endpoint.port || (endpoint.protocol === "wss:" ? 443 : 80)),
    };
  }
  const mode = environment.CODEX_APP_SERVER_MODE === "external" ? "external" : "managed";
  const upstreamPort = Number(environment.CODEX_APP_SERVER_PORT ?? "18765");
  return {
    mode,
    upstreamPort,
    upstreamUrl:
      mode === "external"
        ? environment.CODEX_APP_SERVER_URL ?? `ws://127.0.0.1:${upstreamPort}`
        : `ws://127.0.0.1:${upstreamPort}`,
  };
}

async function portAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function waitUntilReady(port: number, child: ChildProcess) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`codex app-server 已退出：${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return;
    } catch {
      // 启动期间连接失败是预期行为。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待 codex app-server 就绪超时");
}

export async function resolveManagedLaunch(executable: string, args: string[], electron = Boolean(process.versions.electron)) {
  let nodeScript = false;
  if (electron) {
    try { const file = await open(executable, "r"); try { const bytes = Buffer.alloc(128); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0); const line = bytes.subarray(0, bytesRead).toString().split("\n")[0]; nodeScript = line.startsWith("#!") && /\bnode(?:\s|$)/.test(line); } finally { await file.close(); } } catch { /* spawn 会报告无效程序路径。 */ }
  }
  return { executable: nodeScript ? process.execPath : executable, args: nodeScript ? [executable, ...args] : args, environment: nodeScript ? { ELECTRON_RUN_AS_NODE: "1" } : {} };
}

export async function startManagedAppServer(port: number, executable = "codex") {
  if (!(await portAvailable(port))) {
    throw new Error(`app-server 端口 ${port} 已被占用`);
  }
  const launch = await resolveManagedLaunch(executable, appServerCommand(port));
  const child = spawn(launch.executable, launch.args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...appServerEnvironment(), ...launch.environment },
  });
  const spawnError = new Promise<never>((_, reject) =>
    child.once("error", (error) => reject(new Error(`无法启动 codex app-server：${error.message}`))),
  );
  try {
    await Promise.race([waitUntilReady(port, child), spawnError]);
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
  let closing = false;
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      if (!closing) resolve(code);
    });
  });
  return {
    child,
    exited,
    async close() {
      if (child.exitCode !== null) return;
      closing = true;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 3_000).unref();
      });
    },
  };
}
