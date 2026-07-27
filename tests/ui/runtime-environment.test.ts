import { describe, expect, it } from "vitest";
import {
  applyRuntimeEnvironment,
  isAndroidWebView,
} from "../../src/ui/runtime-environment";

describe("运行容器识别", () => {
  it("识别 Android WebView 并忽略普通 Android Chrome", () => {
    expect(
      isAndroidWebView(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
    expect(
      isAndroidWebView(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
  });

  it("只在 Android WebView 下添加顶部安全区覆盖 class", () => {
    const root = document.createElement("html");
    applyRuntimeEnvironment(root, "Android; wv)");
    expect(root.classList.contains("android-webview")).toBe(true);

    applyRuntimeEnvironment(root, "Mozilla/5.0 Chrome/138 Safari/537.36");
    expect(root.classList.contains("android-webview")).toBe(false);
  });
});
