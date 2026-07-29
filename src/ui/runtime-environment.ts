export function isAndroidWebView(userAgent: string) {
  return (
    /Android/i.test(userAgent) &&
    (/(?:^|[; ])wv(?:[); ]|$)/i.test(userAgent) ||
      /Version\/4\.0\b.*Chrome\/.*Mobile Safari/i.test(userAgent))
  );
}

function isIosWebView(userAgent: string) {
  return (
    /(?:iPhone|iPad|iPod)/i.test(userAgent) &&
    /AppleWebKit/i.test(userAgent) &&
    !/Safari\//i.test(userAgent)
  );
}

export function isMobileBrowser(userAgent: string) {
  return (
    /(?:Android|iPhone|iPad|iPod|Mobile)/i.test(userAgent) &&
    !isAndroidWebView(userAgent) &&
    !isIosWebView(userAgent)
  );
}

export interface AndroidWebViewBridge {
  safeAreaTopCssPx?: () => number;
}

export function applyRuntimeEnvironment(
  root: HTMLElement,
  userAgent: string,
  bridge?: AndroidWebViewBridge,
) {
  const androidWebView = isAndroidWebView(userAgent);
  const nativeWebView = androidWebView || isIosWebView(userAgent);
  root.classList.toggle("android-webview", androidWebView);
  root.classList.toggle("native-webview", nativeWebView);
  root.classList.toggle("mobile-browser", isMobileBrowser(userAgent));
  root.style.removeProperty("--native-safe-area-top");

  if (!androidWebView || typeof bridge?.safeAreaTopCssPx !== "function") {
    return;
  }

  try {
    const safeAreaTop = bridge.safeAreaTopCssPx();
    if (Number.isFinite(safeAreaTop) && safeAreaTop >= 0) {
      root.style.setProperty("--native-safe-area-top", `${safeAreaTop}px`);
    }
  } catch {
    // The native bridge is optional and may not be ready during early startup.
  }
}
