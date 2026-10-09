import type { BackendConfig } from "./types";
import type { UploadedFile,DraftImage } from "../ui/attachments";
import { t } from "../i18n";

type Fetcher = typeof fetch;

export function remoteFilePreviewUrl(
  backend: BackendConfig,
  path: string,
) {
  const url = new URL("/api/files/preview", `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  if (backend.desktopHostId) url.searchParams.set('hostId',backend.desktopHostId);
  url.searchParams.set("path", path);
  return url.toString();
}

export async function uploadConversationAttachments(backend:BackendConfig,images:DraftImage[],files:File[],desktop:boolean){
 const uploaded:UploadedFile[]=[],imagePaths:string[]=[];
 if(!desktop)return {files:await Promise.all(files.map(file=>uploadFile(backend,file))),imagePaths};
 for(const image of images){const encoded=image.url.split(',')[1],bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const result=await uploadFile(backend,new File([bytes],image.name,{type:image.type}));imagePaths.push(result.path);}
 for(const file of files)uploaded.push(await uploadFile(backend,file));
 return {files:uploaded,imagePaths};
}

export async function uploadFile(
  backend: BackendConfig,
  file: File,
  fetcher: Fetcher = fetch,
): Promise<UploadedFile> {
  const url = new URL("/api/uploads/file", `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  if (backend.desktopHostId) url.searchParams.set('hostId',backend.desktopHostId);
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
    const failure=await response.json().catch(()=>({}));
    if (response.status === 413) throw new Error(t("文件不能超过 {size} MB",{size:Math.round((failure.maxBytes??100*1024*1024)/1024/1024)}));
    if(failure.code)throw Object.assign(new Error(failure.error??t("文件上传失败（{status}）",{status:response.status})),{code:failure.code === "ACTION_WRITE_UNKNOWN" ? "UPLOAD_WRITE_UNKNOWN" : failure.code});
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
