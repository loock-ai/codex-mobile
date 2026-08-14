import { ActionSheet } from "../../../ui/ActionSheet";
import { t } from "../../../i18n";

export function VideoPreviewSheet({
  src,
  name,
  details,
  onClose,
}: {
  src: string;
  name: string;
  details?: string;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      title={t("视频预览")}
      ariaLabel={t("视频预览")}
      closeLabel={t("关闭视频预览")}
      onClose={onClose}
      className="video-preview-sheet"
      backdropClassName="video-preview-backdrop"
      footer={details ? <p className="remote-file-path">{details}</p> : undefined}
    >
      <div className="video-preview-stage">
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label={t("播放视频 {name}", { name })}
        >
          {t("浏览器无法播放此视频格式")}
        </video>
      </div>
      <strong className="video-preview-name">{name}</strong>
    </ActionSheet>
  );
}
