import { resolve } from "node:path";
import { hostname as readHostname } from "node:os";
import { join } from "node:path";
import { createGateway, type Gateway } from "./gateway.js";
import {
  assertGatewaySecurity,
  resolveGatewayRuntimeConfig,
  resolveRuntimeConfig,
  startManagedAppServer,
} from "./app-server-manager.js";
import { readCodexProjectDirectories } from "./codex-projects.js";
import { writeRuntimeAccess } from "./runtime-access.js";

const runtime = resolveRuntimeConfig();
const gatewayRuntime = resolveGatewayRuntimeConfig(
  process.env,
  readHostname(),
);
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT || "18766");
assertGatewaySecurity(
  host,
  process.env.CODEX_MOBILE_TOKEN,
);
const managed =
  runtime.mode === "managed" ? await startManagedAppServer(runtime.upstreamPort) : null;
let gateway: Gateway;
try {
  gateway = await createGateway({
    host,
    port,
    mode: runtime.mode,
    upstreamUrl: runtime.upstreamUrl,
    staticDir: gatewayRuntime.serveStatic
      ? process.env.CODEX_MOBILE_STATIC_DIR || resolve(process.cwd(), "dist")
      : null,
    accessToken: process.env.CODEX_MOBILE_TOKEN,
    hostId: gatewayRuntime.hostId,
    displayName: gatewayRuntime.displayName,
    hostname: gatewayRuntime.hostname,
    gatewayVersion:
      process.env.CODEX_MOBILE_VERSION ??
      process.env.npm_package_version ??
      "0.2.0",
    uploadDir:
      process.env.CODEX_MOBILE_UPLOAD_DIR ??
      join(
        process.env.CODEX_HOME || join(process.env.HOME || "", ".codex"),
        "codex-mobile-uploads",
      ),
    readProjectDirectories: () =>
      readCodexProjectDirectories(
        join(
          process.env.CODEX_HOME || join(process.env.HOME || "", ".codex"),
          ".codex-global-state.json",
        ),
      ),
    appServerReady: async () => {
      try {
        const ready = new URL(runtime.upstreamUrl);
        ready.protocol = ready.protocol === "wss:" ? "https:" : "http:";
        ready.pathname = "/readyz";
        ready.search = "";
        ready.hash = "";
        const response = await fetch(ready, {
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  });
} catch (error) {
  await managed?.close();
  throw error;
}

await writeRuntimeAccess(process.env.CODEX_MOBILE_RUNTIME_FILE, {
  port: gateway.port,
  token: process.env.CODEX_MOBILE_TOKEN ?? "",
});

console.log(
  `Codex Mobile Web: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${gateway.port} (${runtime.mode})`,
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await gateway.close();
  await managed?.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
managed?.exited.then(async (code) => {
  if (stopping) return;
  console.error(`codex app-server 意外退出：${code ?? "signal"}`);
  stopping = true;
  await gateway.close();
  process.exit(1);
});
