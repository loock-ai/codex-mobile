import { useState } from "react";
import { ActionSheet } from "../../../ui/ActionSheet";
import { ActionSheetDownload } from "../../../ui/ActionSheetDownload";
import { t } from "../../../i18n";
import videoPoster from "../../../assets/video-poster.svg";

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
  const [metadata, setMetadata] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const dimensions = metadata?.src === src ? metadata : null;

  return (
    <ActionSheet
      title={t("视频预览")}
      ariaLabel={t("视频预览")}
      closeLabel={t("关闭视频预览")}
      onClose={onClose}
      headerActions={
        <ActionSheetDownload
          href={src}
          filename={name}
          label={t("下载视频")}
        />
      }
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
          poster={dimensions ? undefined : videoPoster}
          width={dimensions?.width}
          height={dimensions?.height}
          style={
            dimensions
              ? { aspectRatio: `${dimensions.width} / ${dimensions.height}` }
              : undefined
          }
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            if (videoWidth > 0 && videoHeight > 0) {
              setMetadata({ src, width: videoWidth, height: videoHeight });
            }
          }}
          aria-label={t("播放视频 {name}", { name })}
        >
          {t("浏览器无法播放此视频格式")}
        </video>
      </div>
      <strong className="video-preview-name">{name}</strong>
    </ActionSheet>
  );
}
