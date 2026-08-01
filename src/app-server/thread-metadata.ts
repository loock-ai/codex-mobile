import type { AppServerClient } from "./client";
import type { DisplayRecord } from "../ui/app-display";
import { t } from "../i18n";

export async function setThreadPinned(
  client: Pick<AppServerClient, "request">,
  threadId: string,
  isPinned: boolean,
) {
  const result = await client.request<{ thread: DisplayRecord }>(
    "thread/metadata/update",
    { threadId, isPinned },
  );
  if (result.thread?.isPinned !== isPinned) {
    throw new Error(t("服务端返回的置顶状态不一致"));
  }
  return result.thread;
}

export function activeThreadAfterArchive(
  active: DisplayRecord | null,
  archivedThreadId: string,
) {
  return active?.id === archivedThreadId ? null : active;
}
