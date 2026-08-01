import { useEffect, useState } from "react";
import { AppIcon } from "./app-display";
import { t } from "../i18n";

export function ErrorBanner({ message }: { message: string }) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) setDismissedMessage(null);
  }, [message]);

  if (!message || dismissedMessage === message) return null;

  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button
        type="button"
        aria-label={t("关闭错误提示")}
        onClick={() => setDismissedMessage(message)}
      >
        <AppIcon name="close" />
      </button>
    </div>
  );
}
