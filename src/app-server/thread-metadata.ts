import type { AppServerClient } from "./client";
import type { DisplayRecord } from "../ui/app-display";

export async function setThreadPinned(
  client: Pick<AppServerClient, "request">,
  threadId: string,
  isPinned: boolean,
) {
  const result = await Promise.race([
    client.request<{ thread: DisplayRecord }>(
      "thread/metadata/update",
      { threadId, isPinned },
    ),
    new Promise<never>((_, reject) => {
      globalThis.setTimeout(
        () =>
          reject(
            new Error(
              "当前 Codex CLI 不支持持久化置顶，请升级到支持 isPinned 的版本后重试",
            ),
          ),
        1200,
      );
    }),
  ]);
  if (result.thread?.isPinned !== isPinned) {
    throw new Error(
      "当前 Codex CLI 不支持持久化置顶，请升级到支持 isPinned 的版本后重试",
    );
  }
  return result.thread;
}

export function activeThreadAfterArchive(
  active: DisplayRecord | null,
  archivedThreadId: string,
) {
  return active?.id === archivedThreadId ? null : active;
}
