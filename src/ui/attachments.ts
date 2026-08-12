export const MAX_DRAFT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_DRAFT_FILES = 4;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const acceptedImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isNativeImageFile(file: Pick<File, "type">) {
  return acceptedImageTypes.has(file.type);
}

export interface DraftImage {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
}

export interface DraftFile {
  id: string;
  name: string;
  type: string;
  size: number;
  file: File;
  previewUrl: string;
}

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  path: string;
}

type ImageReader = (file: File) => Promise<string>;

export class ImageReadGeneration {
  private generation = 0;

  begin() {
    return ++this.generation;
  }

  invalidate() {
    this.generation += 1;
  }

  isCurrent(token: number) {
    return token === this.generation;
  }
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(t("无法读取 {name}", { name: file.name })));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(t("无法读取 {name}", { name: file.name })));
    });
    reader.readAsDataURL(file);
  });
}

export async function prepareImageFiles(
  files: Iterable<File> | ArrayLike<File>,
  existingCount: number,
  read: ImageReader = readFileAsDataUrl,
  existingBytes = 0,
) {
  const images: DraftImage[] = [];
  const errors: string[] = [];
  const available = Math.max(0, MAX_DRAFT_IMAGES - existingCount);
  let quantityErrorAdded = false;
  let totalBytes = existingBytes;
  let totalSizeErrorAdded = false;

  for (const [index, file] of Array.from(files).entries()) {
    if (!acceptedImageTypes.has(file.type)) {
      errors.push(t("{name} 不是支持的图片格式", { name: file.name }));
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(t("{name} 超过 10 MB", { name: file.name }));
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
      if (!totalSizeErrorAdded) {
        errors.push(t("图片总大小不能超过 20 MB"));
        totalSizeErrorAdded = true;
      }
      continue;
    }
    if (images.length >= available) {
      if (!quantityErrorAdded) {
        errors.push(t("最多上传 {count} 张图片", { count: MAX_DRAFT_IMAGES }));
        quantityErrorAdded = true;
      }
      continue;
    }
    try {
      const url = await read(file);
      if (!url.startsWith(`data:${file.type};base64,`)) {
        errors.push(t("{name} 内容格式与 {type} 不一致", { name: file.name, type: file.type }));
        continue;
      }
      images.push({
        id: `draft-${Date.now()}-${index}-${file.name}`,
        name: file.name,
        type: file.type,
        size: file.size,
        url,
      });
      totalBytes += file.size;
    } catch {
      errors.push(t("无法读取 {name}", { name: file.name }));
    }
  }

  return { images, errors };
}

export function prepareAttachmentFiles(
  files: Iterable<File> | ArrayLike<File>,
  existingCount: number,
  createPreview: (file: File) => string = (file) => URL.createObjectURL(file),
) {
  const prepared: DraftFile[] = [];
  const errors: string[] = [];
  const available = Math.max(0, MAX_DRAFT_FILES - existingCount);
  let quantityErrorAdded = false;

  for (const [index, file] of Array.from(files).entries()) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push(t("{name} 超过 100 MB", { name: file.name }));
      continue;
    }
    if (prepared.length >= available) {
      if (!quantityErrorAdded) {
        errors.push(t("最多上传 {count} 个文件", { count: MAX_DRAFT_FILES }));
        quantityErrorAdded = true;
      }
      continue;
    }
    prepared.push({
      id: `draft-file-${Date.now()}-${index}-${file.name}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      file,
      previewUrl: createPreview(file),
    });
  }

  return { files: prepared, errors };
}

function draftImageIdentity(image: DraftImage) {
  return `${image.name}\u0000${image.type}\u0000${image.size}\u0000${image.url}`;
}

export function mergeDraftImages(
  current: DraftImage[],
  recovered: DraftImage[],
) {
  const merged: DraftImage[] = [];
  const identities = new Set<string>();
  let totalBytes = 0;
  for (const image of [...current, ...recovered]) {
    const identity = draftImageIdentity(image);
    if (
      identities.has(identity) ||
      merged.length >= MAX_DRAFT_IMAGES ||
      totalBytes + image.size > MAX_TOTAL_IMAGE_BYTES
    ) {
      continue;
    }
    identities.add(identity);
    merged.push(image);
    totalBytes += image.size;
  }
  return merged;
}

function uploadedFileInput(file: UploadedFile) {
  return `${t("已上传文件：{name}", { name: file.name })}\n${t("本机路径：{path}", { path: file.path })}`;
}

export function buildTurnInput(
  text: string,
  images: DraftImage[],
  files: UploadedFile[] = [],
) {
  return [
    ...(text
      ? [{ type: "text" as const, text, text_elements: [] as unknown[] }]
      : []),
    ...images.map((image) => ({
      type: "image" as const,
      url: image.url,
    })),
    ...files.map((file) => ({
      type: "text" as const,
      text: uploadedFileInput(file),
      text_elements: [] as unknown[],
    })),
  ];
}

export function buildOptimisticUserContent(
  text: string,
  images: DraftImage[],
  files: UploadedFile[] = [],
) {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((image) => ({
      type: "image" as const,
      url: image.url,
    })),
    ...files.map((file) => ({
      type: "text" as const,
      text: t("文件：{name}", { name: file.name }),
    })),
  ];
}
import { t } from "../i18n";
