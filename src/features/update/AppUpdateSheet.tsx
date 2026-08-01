import type { AppUpdateState } from "./useAppUpdate";
import { ActionSheet } from "../../ui/ActionSheet";
import { t } from "../../i18n";

function statusLabel(state: AppUpdateState) {
  switch (state.phase) {
    case "downloading":
      return t("正在下载 {progress}%", { progress: Math.max(0, Math.min(100, Math.round(state.progress ?? 0))) });
    case "verifying":
      return t("正在验证安装包");
    case "installing":
      return t("正在打开系统安装器");
    default:
      return "";
  }
}
export function AppUpdateSheet({
  open,
  state,
  onClose,
  onInstall,
  onRetry,
}: {
  open: boolean;
  state: AppUpdateState;
  onClose: () => void;
  onInstall: () => void;
  onRetry: () => void;
}) {
  if (!open || !state.release) return null;
  const working = ["downloading", "verifying", "installing"].includes(
    state.phase,
  );
  const label = statusLabel(state);

  return (
    <ActionSheet
      title={
          <div>
            <small>Codex Mobile</small>
            <h2>{t("发现新版本")}</h2>
          </div>
      }
      ariaLabel={t("发现新版本")}
      className="app-update-sheet"
      backdropClassName="app-update-backdrop"
      closeOnBackdrop={false}
      closeLabel={t("关闭更新")}
      closeDisabled={working}
      footer={
        <>
          <button type="button" disabled={working} onClick={onClose}>
            {t("稍后")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={working}
            onClick={state.phase === "error" ? onRetry : onInstall}
          >
            {state.phase === "error" ? t("重试") : working ? label : t("立即更新")}
          </button>
        </>
      }
    >
        <div className="app-update-content">
          <strong>v{state.release.version}</strong>
          <p className="app-update-current">
            {t("当前版本 v{version}", { version: state.currentVersion })}
          </p>
          <div className="app-update-notes">{state.release.notes}</div>
          {label && (
            <div className="app-update-progress" aria-live="polite">
              <span>{label}</span>
              {state.phase === "downloading" && (
                <i style={{ width: `${state.progress ?? 0}%` }} />
              )}
            </div>
          )}
          {state.phase === "error" && (
            <p className="app-update-error" role="alert">
              {state.error || t("更新失败，请重试")}
            </p>
          )}
        </div>
    </ActionSheet>
  );
}
