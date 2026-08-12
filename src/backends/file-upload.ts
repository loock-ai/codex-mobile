import type { BackendConfig } from "./types";
import type { UploadedFile } from "../ui/attachments";
import { t } from "../i18n";

type Fetcher = typeof fetch;

export async function uploadFile(
  backend: BackendConfig,
  file: File,
  fetcher: Fetcher = fetch,
): Promise<UploadedFile> {
  const url = new URL("/api/uploads/file", `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  const response = await fetcher(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-codex-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    if (response.status === 413) throw new Error(t("文件不能超过 100 MB"));
    throw new Error(t("文件上传失败（{status}）", { status: response.status }));
  }
  const result = (await response.json()) as Partial<UploadedFile>;
  if (
    typeof result.path !== "string" ||
    typeof result.name !== "string" ||
    typeof result.type !== "string" ||
    typeof result.size !== "number"
  ) {
    throw new Error(t("文件上传响应无效"));
  }
  return result as UploadedFile;
}
