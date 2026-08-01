import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActionSheet } from "../../ui/ActionSheet";
import { t } from "../../i18n";
import {
  scanGatewayQrImage,
  startGatewayQrScanner,
} from "./gateway-qr-scanner";

export function GatewayQrScannerSheet({
  open,
  onScan,
  onClose,
}: {
  open: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [readingImage, setReadingImage] = useState(false);

  useEffect(() => {
    if (!open || !videoRef.current) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    setError("");
    void startGatewayQrScanner(videoRef.current, (value) => {
      if (!disposed) onScan(value);
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else stop = cleanup;
      })
      .catch(() => {
        if (!disposed) {
          setError(t("无法打开摄像头，可从相册选择二维码"));
        }
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onScan, open]);

  if (!open) return null;

  const readImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || readingImage) return;
    setReadingImage(true);
    setError("");
    try {
      onScan(await scanGatewayQrImage(file));
    } catch {
      setError(t("未识别到二维码，请换一张图片"));
    } finally {
      setReadingImage(false);
    }
  };

  return (
    <ActionSheet
      title={t("扫描网关二维码")}
      onClose={onClose}
      closeLabel={t("关闭扫码")}
      closeOnBackdrop={false}
      className="gateway-qr-sheet"
    >
      <div className="gateway-qr-camera">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t("二维码摄像头画面")}
        />
        <div className="gateway-qr-reticle" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <p className="gateway-qr-hint">
        {t("将另一台设备上的连接二维码放入框内")}
      </p>
      {error && (
        <p className="backend-form-error" role="alert">
          {error}
        </p>
      )}
      <label className="gateway-qr-file">
        <span>{readingImage ? t("正在识别…") : t("从相册选择二维码")}</span>
        <input
          type="file"
          accept="image/*"
          disabled={readingImage}
          onChange={readImage}
        />
      </label>
    </ActionSheet>
  );
}
