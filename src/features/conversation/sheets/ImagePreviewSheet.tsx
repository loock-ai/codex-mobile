import {
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { ActionSheet } from "../../../ui/ActionSheet";
import { ActionSheetDownload } from "../../../ui/ActionSheetDownload";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function pointerDistance(
  first: { x: number; y: number },
  second: { x: number; y: number },
) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function ImagePreviewSheet({
  src,
  name,
  alt = name,
  details = "",
  onClose,
}: {
  src: string;
  name: string;
  alt?: string;
  details?: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const pinchOrigin = useRef<{ distance: number; scale: number } | null>(null);

  const applyScale = (value: number) => {
    const next = clampScale(value);
    scaleRef.current = next;
    setScale(next);
    if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 1) {
      dragOrigin.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      pinchOrigin.current = {
        distance: pointerDistance(first, second),
        scale: scaleRef.current,
      };
      dragOrigin.current = null;
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const previous = pointers.current.get(event.pointerId)!;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    if (pointers.current.size === 2 && pinchOrigin.current) {
      const [first, second] = Array.from(pointers.current.values());
      const distance = pointerDistance(first, second);
      applyScale(
        pinchOrigin.current.scale *
          (distance / Math.max(1, pinchOrigin.current.distance)),
      );
      return;
    }
    if (
      pointers.current.size === 1 &&
      scaleRef.current > 1 &&
      dragOrigin.current
    ) {
      setOffset((current) => ({
        x: current.x + next.x - previous.x,
        y: current.y + next.y - previous.y,
      }));
      dragOrigin.current = next;
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    pinchOrigin.current = null;
    const remaining = Array.from(pointers.current.values())[0] ?? null;
    dragOrigin.current = remaining;
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    applyScale(
      scaleRef.current + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP),
    );
  };

  const reset = () => {
    scaleRef.current = 1;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return createPortal(
    <ActionSheet
      title="图片预览"
      ariaLabel="图片预览"
      onClose={onClose}
      closeLabel="关闭图片预览"
      className="image-preview-sheet"
      backdropClassName="image-preview-backdrop"
      headerActions={
        <ActionSheetDownload
          href={src}
          filename={name}
          label="下载图片"
        />
      }
    >
      <div
        className={`image-preview-stage${scale > 1 ? " zoomed" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
        onDoubleClick={() => applyScale(scaleRef.current === 1 ? 2 : 1)}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        />
      </div>
      <div className="image-preview-controls" aria-label="图片缩放">
        <button
          type="button"
          aria-label="缩小图片"
          disabled={scale <= MIN_SCALE}
          onClick={() => applyScale(scale - SCALE_STEP)}
        >
          −
        </button>
        <output aria-live="polite">{Math.round(scale * 100)}%</output>
        <button
          type="button"
          aria-label="放大图片"
          disabled={scale >= MAX_SCALE}
          onClick={() => applyScale(scale + SCALE_STEP)}
        >
          ＋
        </button>
        <button
          type="button"
          aria-label="还原图片"
          disabled={scale === 1 && offset.x === 0 && offset.y === 0}
          onClick={reset}
        >
          还原
        </button>
      </div>
      {details && <p className="image-preview-details">{details}</p>}
    </ActionSheet>,
    document.body,
  );
}
