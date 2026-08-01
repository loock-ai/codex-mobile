import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APP_UPDATE_API_URL,
  compareSemanticVersions,
  createReleaseChecker,
  type AppRelease,
} from "../../app-update/release";
import { t } from "../../i18n";
import {
  APP_UPDATE_EVENT,
  readAndroidAppUpdateBridge,
  type AndroidAppUpdateBridge,
  type AppUpdateNativeEvent,
} from "../../app-update/native-bridge";

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "installing"
  | "error";

export interface AppUpdateState {
  phase: AppUpdatePhase;
  currentVersion: string;
  release?: AppRelease;
  progress?: number;
  error?: string;
}

export interface AppUpdateController {
  supported: boolean;
  state: AppUpdateState;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  check: (force?: boolean) => Promise<void>;
  install: () => void;
}

interface UseAppUpdateOptions {
  bridge?: AndroidAppUpdateBridge | null;
  fetchRelease?: () => Promise<unknown>;
  storage?: Storage;
}

function bridgeVersion(bridge: AndroidAppUpdateBridge | null) {
  try {
    const version = bridge?.appVersion?.().trim();
    if (version) return version.replace(/^v/, "");
  } catch {
    // Older containers may expose a partial bridge.
  }
  return "0.2.0";
}

async function fetchLatestRelease() {
  const response = await fetch(
    APP_UPDATE_API_URL,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(t("检查更新失败（HTTP {status}）", { status: response.status }));
  }
  return response.json() as Promise<unknown>;
}

export function useAppUpdate(
  options: UseAppUpdateOptions = {},
): AppUpdateController {
  const [bridge] = useState(() =>
    options.bridge === undefined
      ? readAndroidAppUpdateBridge()
      : options.bridge,
  );
  const supported = bridge !== null;
  const [currentVersion] = useState(() => bridgeVersion(bridge));
  const [storage] = useState(() => options.storage ?? window.localStorage);
  const [fetchRelease] = useState(
    () => options.fetchRelease ?? fetchLatestRelease,
  );
  const checker = useMemo(
    () =>
      createReleaseChecker({
        fetchRelease,
        storage,
      }),
    [fetchRelease, storage],
  );
  const [state, setState] = useState<AppUpdateState>({
    phase: "idle",
    currentVersion,
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const presentedVersionRef = useRef("");

  const check = useCallback(
    async (force = false) => {
      if (!supported) return;
      setState((current) => ({
        ...current,
        phase: "checking",
        currentVersion,
        error: undefined,
      }));
      try {
        const release = await checker.check(force);
        const available =
          compareSemanticVersions(release.version, currentVersion) > 0;
        setState({
          phase: available ? "available" : "current",
          currentVersion,
          release: available ? release : undefined,
        });
        if (
          available &&
          (force || presentedVersionRef.current !== release.version)
        ) {
          presentedVersionRef.current = release.version;
          setSheetOpen(true);
        }
      } catch (reason) {
        setState((current) => ({
          ...current,
          phase: "error",
          currentVersion,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      }
    },
    [checker, currentVersion, supported],
  );

  useEffect(() => {
    if (!supported) return;
    void check(false);
  }, [check, supported]);

  useEffect(() => {
    if (!supported) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check, supported]);

  useEffect(() => {
    if (!supported) return;
    const onNativeUpdate = (event: Event) => {
      const detail = (event as CustomEvent<AppUpdateNativeEvent>).detail;
      if (!detail?.phase) return;
      setState((current) => ({
        ...current,
        phase: detail.phase,
        progress:
          detail.phase === "downloading"
            ? Math.max(0, Math.min(100, detail.progress ?? 0))
            : current.progress,
        error: detail.phase === "error" ? detail.error : undefined,
      }));
      setSheetOpen(true);
    };
    window.addEventListener(APP_UPDATE_EVENT, onNativeUpdate);
    return () => window.removeEventListener(APP_UPDATE_EVENT, onNativeUpdate);
  }, [supported]);

  const install = useCallback(() => {
    if (!bridge?.installApk || !state.release) return;
    try {
      bridge.installApk(state.release.downloadUrl, state.release.sha256);
      setState((current) => ({
        ...current,
        phase: "downloading",
        progress: 0,
        error: undefined,
      }));
      setSheetOpen(true);
    } catch (reason) {
      setState((current) => ({
        ...current,
        phase: "error",
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }, [bridge, state.release]);

  return {
    supported,
    state,
    sheetOpen,
    setSheetOpen,
    check,
    install,
  };
}
