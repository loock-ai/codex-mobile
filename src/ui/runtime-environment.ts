export function isAndroidWebView(userAgent: string) {
  return (
    /Android/i.test(userAgent) &&
    (/(?:^|[; ])wv(?:[); ]|$)/i.test(userAgent) ||
      /Version\/4\.0\b.*Chrome\/.*Mobile Safari/i.test(userAgent))
  );
}

export function applyRuntimeEnvironment(
  root: HTMLElement,
  userAgent: string,
) {
  root.classList.toggle("android-webview", isAndroidWebView(userAgent));
}
