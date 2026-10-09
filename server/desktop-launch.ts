import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { appServerEnvironment, resolveRuntimeConfig } from "./app-server-manager.js";

export function desktopLaunchConfig(
  appPath: string,
  address: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const gatewayEnvironment = { CODEX_APP_SERVER_MODE: "desktop", CODEX_APP_SERVER_WS_URL: address };
  resolveRuntimeConfig(gatewayEnvironment);
  const desktopEnvironment = appServerEnvironment(environment);
  delete desktopEnvironment.CODEX_APP_SERVER_FORCE_CLI;
  delete desktopEnvironment.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
  delete desktopEnvironment.CODEX_CLI_PATH;
  const launchEnvironment: NodeJS.ProcessEnv = {
    ...desktopEnvironment, CODEX_APP_SERVER_WS_URL: address,
  };
  return {
    executable: join(appPath, "Contents/MacOS/ChatGPT"),
    environment: launchEnvironment,
    gatewayEnvironment,
  };
}

/** 只连接已启动的共享服务；不能终止或接管正在运行的 Desktop。 */
export async function launchSharedDesktop(checkOnly = false) {
  if (process.platform !== "darwin") throw new Error("Desktop 共享启动目前仅支持 macOS");
  const appPath = process.env.CODEX_DESKTOP_APP_PATH || "/Applications/ChatGPT.app";
  const config = desktopLaunchConfig(appPath, process.env.CODEX_APP_SERVER_WS_URL || "");
  await access(config.executable, constants.X_OK);
  const archive = await readFile(join(appPath, "Contents/Resources/app.asar"));
  if (!archive.includes(Buffer.from("CODEX_APP_SERVER_WS_URL"))) {
    throw new Error("此 Desktop 版本未检测到共享 WebSocket 入口");
  }
  const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "comm="], { timeout: 5000 });
  if (stdout.split("\n").some((line) => line.trim() === config.executable)) {
    throw new Error("Desktop 正在运行，请先在适当时机退出 Desktop，再使用共享连接启动；不会自动结束现有任务");
  }
  const readyUrl = new URL(config.gatewayEnvironment.CODEX_APP_SERVER_WS_URL);
  readyUrl.protocol = readyUrl.protocol === "wss:" ? "https:" : "http:";
  readyUrl.pathname = "/readyz";
  readyUrl.search = "";
  const response = await fetch(readyUrl, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("共享 App Server 尚未就绪");
  if (checkOnly) return { launched: false, ...config.gatewayEnvironment };
  const child = spawn(config.executable, [], { env: config.environment, detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  return { launched: true, pid: child.pid, ...config.gatewayEnvironment };
}
