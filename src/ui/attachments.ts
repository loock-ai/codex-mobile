export const MAX_DRAFT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

const acceptedImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface DraftImage {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
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
      else reject(new Error(`无法读取 ${file.name}`));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(`无法读取 ${file.name}`));
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
      errors.push(`${file.name} 不是支持的图片格式`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name} 超过 10 MB`);
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
      if (!totalSizeErrorAdded) {
        errors.push("图片总大小不能超过 20 MB");
        totalSizeErrorAdded = true;
      }
      continue;
    }
    if (images.length >= available) {
      if (!quantityErrorAdded) {
        errors.push(`最多上传 ${MAX_DRAFT_IMAGES} 张图片`);
        quantityErrorAdded = true;
      }
      continue;
    }
    try {
      const url = await read(file);
      if (!url.startsWith(`data:${file.type};base64,`)) {
        errors.push(`${file.name} 内容格式与 ${file.type} 不一致`);
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
      errors.push(`无法读取 ${file.name}`);
    }
  }

  return { images, errors };
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

export function buildTurnInput(text: string, images: DraftImage[]) {
  return [
    ...(text
      ? [{ type: "text" as const, text, text_elements: [] as unknown[] }]
      : []),
    ...images.map((image) => ({
      type: "image" as const,
      url: image.url,
    })),
  ];
}

export function buildOptimisticUserContent(
  text: string,
  images: DraftImage[],
) {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((image) => ({
      type: "image" as const,
      url: image.url,
    })),
  ];
}
