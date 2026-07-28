import type { AndroidWebViewBridge } from "../ui/runtime-environment";

export const APP_UPDATE_EVENT = "codex-mobile-app-update";

export interface AndroidAppUpdateBridge extends AndroidWebViewBridge {
  appVersion?: () => string;
  installApk?: (downloadUrl: string, sha256: string) => void;
}
export interface AppUpdateNativeEvent {
  phase: "downloading" | "verifying" | "installing" | "error";
  progress?: number;
  error?: string;
}

export function readAndroidAppUpdateBridge(
  scope: typeof window = window,
): AndroidAppUpdateBridge | null {
  const bridge = (
    scope as typeof window & { JsBridge?: AndroidAppUpdateBridge }
  ).JsBridge;
  if (
    typeof bridge?.appVersion !== "function" ||
    typeof bridge.installApk !== "function"
  ) {
    return null;
  }
  return bridge;
}
