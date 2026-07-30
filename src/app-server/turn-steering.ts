type DisplayRecord = Record<string, any>;

export type PendingSteerMessage = {
  id: string;
  threadId: string;
  text: string;
};

const runningStatuses = new Set(["inProgress", "in_progress", "running"]);

export function activeTurnId(thread: DisplayRecord | null | undefined) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnId = String(turn?.id ?? "");
    if (
      turnId &&
      !turnId.startsWith("pending-") &&
      runningStatuses.has(String(turn?.status))
    ) {
      return turnId;
    }
  }
  return null;
}

export function mergeSteerDraft(current: string, failedDraft: string) {
  if (!current) return failedDraft;
  if (!failedDraft || current === failedDraft) return current;
  return `${failedDraft}\n${current}`;
}

export function clearPendingSteerForRequest(
  current: PendingSteerMessage | null,
  requestId: string,
) {
  return current?.id === requestId ? null : current;
}

export function clearPendingSteerForThread(
  current: PendingSteerMessage | null,
  threadId: string,
) {
  return current?.threadId === threadId ? null : current;
}

export function clearPendingSteerForItem(
  current: PendingSteerMessage | null,
  params: { threadId?: unknown; item?: DisplayRecord },
) {
  if (
    !current ||
    current.threadId !== String(params.threadId ?? "") ||
    params.item?.type !== "userMessage" ||
    String(params.item.clientId ?? "") !== current.id
  ) {
    return current;
  }
  return null;
}

export function clearPendingSteerForTimeline(
  current: PendingSteerMessage | null,
  thread: DisplayRecord | null | undefined,
) {
  if (!current || current.threadId !== String(thread?.id ?? "")) {
    return current;
  }
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const items = Array.isArray(turns[turnIndex]?.items)
      ? turns[turnIndex].items
      : [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (
        item?.type === "userMessage" &&
        String(item.clientId ?? "") === current.id
      ) {
        return null;
      }
    }
  }
  return current;
}

export function buildTurnSteerParams({
  threadId,
  turnId,
  input,
  clientUserMessageId,
}: {
  threadId: string;
  turnId: string;
  input: DisplayRecord[];
  clientUserMessageId: string;
}) {
  return {
    threadId,
    input,
    expectedTurnId: turnId,
    clientUserMessageId,
  };
}
