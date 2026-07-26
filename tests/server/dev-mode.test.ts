import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { viteDevServerConfig } from "../../server/dev-mode.js";

const packageJson = JSON.parse(
  readFileSync("package.json", "utf8"),
) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("MacBook 调试模式", () => {
  it("Vite 从局域网 5173 提供页面并代理本机网关", () => {
    expect(viteDevServerConfig).toMatchObject({
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:4173",
          changeOrigin: false,
        },
        "/ws": {
          target: "ws://127.0.0.1:4173",
          changeOrigin: false,
          ws: true,
        },
      },
    });
  });

  it("npm run dev 同时启动网关和 Vite，并读取本机网关环境", () => {
    expect(packageJson.devDependencies).toHaveProperty("concurrently");
    expect(packageJson.scripts.dev).toContain("gateway.env");
    expect(packageJson.scripts.dev).toContain("npm exec -- concurrently");
    expect(packageJson.scripts.dev).toContain("--kill-others");
    expect(packageJson.scripts.dev).toContain("npm:dev:gateway");
    expect(packageJson.scripts.dev).toContain("npm:dev:web");
    expect(packageJson.scripts["dev:gateway"]).toContain("tsx watch");
    expect(packageJson.scripts["dev:gateway"]).toContain(
      "CODEX_MOBILE_SERVE_STATIC=false",
    );
    expect(packageJson.scripts["dev:web"]).toContain("vite");
    expect(packageJson.scripts["dev:web"]).toContain("--port 5173");
  });
});
