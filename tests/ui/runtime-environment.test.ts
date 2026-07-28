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

  it("Android WebView 使用原生顶部安全区作为旧版兼容兜底", () => {
    const root = document.createElement("html");
    const bridge = {
      safeAreaTopCssPx: () => 28,
    };

    applyRuntimeEnvironment(root, "Android; wv)", bridge);
    expect(root.style.getPropertyValue("--native-safe-area-top")).toBe("28px");

    applyRuntimeEnvironment(
      root,
      "Mozilla/5.0 Chrome/138 Safari/537.36",
      bridge,
    );
    expect(root.style.getPropertyValue("--native-safe-area-top")).toBe("");
  });

  it("忽略不可用或异常的原生安全区桥接", () => {
    const root = document.createElement("html");

    expect(() =>
      applyRuntimeEnvironment(root, "Android; wv)", {
        safeAreaTopCssPx: () => {
          throw new Error("bridge unavailable");
        },
      }),
    ).not.toThrow();
    expect(root.style.getPropertyValue("--native-safe-area-top")).toBe("");

    applyRuntimeEnvironment(root, "Android; wv)", {
      safeAreaTopCssPx: () => Number.NaN,
    });
    expect(root.style.getPropertyValue("--native-safe-area-top")).toBe("");
  });
});
