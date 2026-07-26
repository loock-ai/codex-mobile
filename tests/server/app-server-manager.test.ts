import { describe, expect, it } from "vitest";
import { appServerCommand, resolveRuntimeConfig } from "../../server/app-server-manager.js";

describe("app-server 运行模式", () => {
  it("Managed 模式生成仅监听回环地址的启动命令", () => {
    expect(appServerCommand(18765)).toEqual([
      "app-server",
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
});
