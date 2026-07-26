import { resolve } from "node:path";
import { createGateway, type Gateway } from "./gateway.js";
import { resolveRuntimeConfig, startManagedAppServer } from "./app-server-manager.js";

const runtime = resolveRuntimeConfig();
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "4173");
const managed =
  runtime.mode === "managed" ? await startManagedAppServer(runtime.upstreamPort) : null;
let gateway: Gateway;
try {
  gateway = await createGateway({
    host,
    port,
    mode: runtime.mode,
    upstreamUrl: runtime.upstreamUrl,
    staticDir: resolve(process.cwd(), "dist"),
    accessToken: process.env.CODEX_MOBILE_TOKEN,
  });
} catch (error) {
  await managed?.close();
  throw error;
}

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
