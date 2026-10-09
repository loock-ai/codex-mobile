// @vitest-environment node
import { describe, expect, it } from "vitest";
import { desktopLaunchConfig } from "../../server/desktop-launch.js";

describe("Desktop 共享服务启动配置", () => {
  it("两端使用同一地址并清除强制独立 CLI 开关", () => {
    const result = desktopLaunchConfig("/Applications/ChatGPT.app", "ws://127.0.0.1:19876", {
      PATH: "/usr/bin", CODEX_APP_SERVER_FORCE_CLI: "1", CODEX_MOBILE_TOKEN: "secret",
    });
    expect(result.executable).toBe("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT");
    expect(result.environment.CODEX_APP_SERVER_WS_URL).toBe("ws://127.0.0.1:19876");
    expect(result.environment.CODEX_APP_SERVER_FORCE_CLI).toBeUndefined();
    expect(result.environment.CODEX_MOBILE_TOKEN).toBeUndefined();
    expect(result.gatewayEnvironment).toEqual({ CODEX_APP_SERVER_MODE: "desktop", CODEX_APP_SERVER_WS_URL: "ws://127.0.0.1:19876" });
  });
  it("拒绝远程共享地址", () => {
    expect(() => desktopLaunchConfig("/Applications/ChatGPT.app", "ws://example.com:19876", {})).toThrow("本机");
  });
});
