import { describe, expect, it } from "vitest";
import {
  appServerEnvironment,
  appServerCommand,
  assertGatewaySecurity,
  resolveGatewayRuntimeConfig,
  resolveRuntimeConfig,
} from "../../server/app-server-manager.js";

describe("app-server 运行模式", () => {
  it("不会把网关身份和访问口令传给 app-server 子进程", () => {
    expect(
      appServerEnvironment({
        PATH: "/usr/bin",
        CODEX_HOME: "/tmp/codex",
        CODEX_MOBILE_TOKEN: "secret",
        CODEX_MOBILE_ALLOWED_ORIGINS: "http://frontend.local",
        CODEX_MOBILE_HOST_ID: "mini",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/tmp/codex",
    });
  });

  it("非回环监听必须配置口令，但不限制 Origin", () => {
    expect(() =>
      assertGatewaySecurity("0.0.0.0", ""),
    ).toThrow("访问口令");
    expect(() =>
      assertGatewaySecurity("0.0.0.0", "secret"),
    ).not.toThrow();
    expect(() =>
      assertGatewaySecurity("127.0.0.1", ""),
    ).not.toThrow();
  });

  it("Managed 模式生成仅监听回环地址的启动命令", () => {
    expect(appServerCommand(18765)).toEqual([
      "app-server",
      "--enable",
      "realtime_conversation",
      "--listen",
      "ws://127.0.0.1:18765",
    ]);
  });

  it("External 模式保留显式上游地址", () => {
    expect(
      resolveRuntimeConfig({
        CODEX_APP_SERVER_MODE: "external",
        CODEX_APP_SERVER_URL: "ws://192.168.1.8:9000",
      }),
    ).toMatchObject({
      mode: "external",
      upstreamUrl: "ws://192.168.1.8:9000",
    });
  });

  it("解析设备身份和静态资源模式，并忽略旧 Origin 白名单", () => {
    expect(
      resolveGatewayRuntimeConfig(
        {
          CODEX_MOBILE_HOST_ID: "mac-mini",
          CODEX_MOBILE_HOST_NAME: "Mac mini",
          CODEX_MOBILE_ALLOWED_ORIGINS:
            "http://192.168.100.8:4173, http://mac-mini.local:4173 ",
          CODEX_MOBILE_SERVE_STATIC: "false",
        },
        "mac-mini.local",
      ),
    ).toEqual({
      hostId: "mac-mini",
      displayName: "Mac mini",
      hostname: "mac-mini.local",
      serveStatic: false,
    });
  });
});
