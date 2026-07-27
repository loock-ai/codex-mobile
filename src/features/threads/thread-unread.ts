interface ThreadUnreadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function unreadStorageKey(backendId: string) {
  return `codex-mobile:unread:${backendId}`;
}

export function readUnreadThreadIds(
  storage: Pick<ThreadUnreadStorage, "getItem">,
  backendId: string,
) {
  try {
    const value = JSON.parse(storage.getItem(unreadStorageKey(backendId)) ?? "[]");
    if (
      !Array.isArray(value) ||
      !value.every((threadId) => typeof threadId === "string")
    ) {
      return new Set<string>();
    }
    return new Set(value);
  } catch {
    return new Set<string>();
  }
}

export function writeUnreadThreadIds(
  storage: Pick<ThreadUnreadStorage, "setItem">,
  backendId: string,
  threadIds: Set<string>,
) {
  storage.setItem(
    unreadStorageKey(backendId),
    JSON.stringify([...threadIds].sort()),
  );
}

export function shouldMarkThreadUnread({
  threadId,
  activeThreadId,
  conversationVisible,
  documentVisible,
}: {
  threadId: string;
  activeThreadId: string;
  conversationVisible: boolean;
  documentVisible: boolean;
}) {
  return (
    threadId !== activeThreadId ||
    !conversationVisible ||
    !documentVisible
  );
}
