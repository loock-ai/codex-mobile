#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import QRCode from "qrcode";
import {
  createAccessUrl,
  findLanIPv4,
  readRuntimeAccess,
} from "./access-url.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
);
const args = process.argv.slice(2);
const command = args[0] ?? "start";
let commandArgs = args.slice(1);
let port = process.env.PORT || "18766";
const runtimeFile =
  process.env.CODEX_MOBILE_RUNTIME_FILE ||
  resolve(homedir(), ".codex-mobile", "runtime.json");

if (command === "start" || command === "bridge" || command === "control") {
  const remaining = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] !== "--port") {
      remaining.push(commandArgs[index]);
      continue;
    }
    const value = commandArgs[index + 1];
    const number = Number(value);
    if (
      !value ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > 65535
    ) {
      process.stderr.write("端口必须是 1 到 65535 之间的整数\n");
      process.exit(1);
    }
    port = value;
    index += 1;
  }
  commandArgs = remaining;
}

function printHelp() {
  process.stdout.write(`Codex Mobile ${packageJson.version}

用法：
  codex-mobile start [--port <端口>]
  codex-mobile auth [--plain]
  codex-mobile desktop [--check]
  codex-mobile bridge
  codex-mobile control [--port <端口>]
  codex-mobile launcher [--open-web]
  codex-mobile --version
  codex-mobile --help

启动参数通过环境变量配置：
  HOST                    监听地址，默认 127.0.0.1
  PORT                    监听端口，默认 18766
  CODEX_MOBILE_TOKEN      局域网访问口令
  CODEX_MOBILE_CDP_URL    桌面 CDP 地址，control 默认 http://127.0.0.1:9333
  CODEX_MOBILE_HOST_NAME  设备显示名称
  CODEX_MOBILE_UPLOAD_DIR 文件上传目录，默认 ~/.codex/codex-mobile-uploads
  CODEX_APP_SERVER_MODE   managed、external 或 desktop
  CODEX_APP_SERVER_WS_URL Desktop 模式的本机共享 WebSocket 地址

局域网启动示例：
  HOST=0.0.0.0 CODEX_MOBILE_TOKEN='<口令>' codex-mobile start
`);
}

if (command === "--help" || command === "-h" || command === "help") {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v" || command === "version") {
  process.stdout.write(`${packageJson.version}\n`);
  process.exit(0);
}

if (command === "desktop" && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === "--check"))) {
  try {
    const { launchSharedDesktop } = await import(pathToFileURL(resolve(packageRoot, "npm-dist/server/desktop-launch.js")).href);
    const result = await launchSharedDesktop(commandArgs.includes("--check"));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

if (
  command === "auth" &&
  (commandArgs.length === 0 ||
    (commandArgs.length === 1 && commandArgs[0] === "--plain"))
) {
  try {
    const runtime = await readRuntimeAccess(runtimeFile);
    const url = createAccessUrl({
      host: process.env.HOST,
      port: runtime?.port ?? port,
      token: runtime?.token ?? process.env.CODEX_MOBILE_TOKEN,
      lanIp: process.env.CODEX_MOBILE_LAN_IP || findLanIPv4(),
    });
    if (commandArgs.includes("--plain")) {
      process.stdout.write(`${url}\n`);
    } else {
      const qrCode = await QRCode.toString(url, {
        type: "terminal",
        small: true,
      });
      process.stdout.write(`扫描二维码连接：\n${qrCode}\n${url}\n`);
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (command === "launcher" && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === "--open-web"))) {
  const { spawn } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  try {
    const electron = require("electron");
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [resolve(packageRoot, "launcher/main.cjs"), ...commandArgs], { stdio: "inherit", env });
    await new Promise((resolve, reject) => { child.once("exit", code => { process.exitCode = code || 0; resolve(); }); child.once("error", reject); });
  } catch (error) { process.stderr.write(`请使用打包后的启动器 .app，或在源码安装 Electron：${error.message}\n`); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}
if (command === "bridge" && commandArgs.length === 0) {
  process.env.PORT = port === "18766" ? "19877" : port;
  process.env.CODEX_MOBILE_RUNTIME_FILE = runtimeFile;
  process.env.CODEX_MOBILE_STATIC_DIR = resolve(packageRoot, "dist");
  const { startDesktopBridge } = await import(pathToFileURL(resolve(packageRoot,"npm-dist/server/cdp/index.js")).href);
  await startDesktopBridge();
} else if (command === "control" && commandArgs.length === 0) {
  process.env.PORT = port === "18766" ? "19878" : port;
  process.env.CODEX_MOBILE_STATIC_DIR = resolve(packageRoot, "dist");
  try {
    const { startDesktopControl } = await import(pathToFileURL(resolve(packageRoot, "npm-dist/server/cdp/control-index.js")).href);
    await startDesktopControl();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
} else if (command !== "start" || commandArgs.length > 0) {
  process.stderr.write(`未知命令：${args.join(" ") || command}\n`);
  printHelp();
  process.exit(1);
}

if (command === "start") {
process.env.PORT = port;
process.env.CODEX_MOBILE_RUNTIME_FILE = runtimeFile;
process.env.CODEX_MOBILE_STATIC_DIR = resolve(packageRoot, "dist");
process.env.CODEX_MOBILE_VERSION = packageJson.version;
await import(
  pathToFileURL(resolve(packageRoot, "npm-dist/server/index.js")).href
);

}
