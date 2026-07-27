import type {
  ApprovalPolicy,
  ApprovalsReviewer,
} from "../ui/settings";

type AnyRecord = Record<string, any>;
const initialTurnsLimit = 10;

interface Requester {
  request(method: string, params: unknown): Promise<any>;
}

export interface ResumedThreadSession {
  thread: AnyRecord;
  model?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: ApprovalsReviewer;
  activePermissionProfile?: { id: string } | null;
  settingsSynchronized: boolean;
  nextTurnsCursor: string | null;
}

export interface ThreadTurnsPage {
  turns: AnyRecord[];
  nextCursor: string | null;
}

export type OlderTurnsLoadState =
  | "idle"
  | "loading"
  | "error"
  | "exhausted";

function chronologicalTurns(data: AnyRecord[] | undefined) {
  return [...(data ?? [])].reverse();
}

export function prependUniqueTurns(
  current: AnyRecord[],
  older: AnyRecord[],
) {
  const currentIds = new Set(current.map((turn) => String(turn.id)));
  return [
    ...older.filter((turn) => !currentIds.has(String(turn.id))),
    ...current,
  ];
}

export async function loadOlderThreadTurns(
  client: Requester,
  threadId: string,
  cursor: string,
): Promise<ThreadTurnsPage> {
  const response = await client.request("thread/turns/list", {
    threadId,
    cursor,
    limit: initialTurnsLimit,
    sortDirection: "desc",
    itemsView: "full",
  });
  return {
    turns: chronologicalTurns(response.data),
    nextCursor: response.nextCursor ?? null,
  };
}

export async function resumeThreadSession(
  client: Requester,
  threadId: string,
): Promise<ResumedThreadSession> {
  try {
    const response = await client.request("thread/resume", {
      threadId,
      excludeTurns: true,
      initialTurnsPage: {
        limit: initialTurnsLimit,
        sortDirection: "desc",
        itemsView: "full",
      },
    });
    const initialTurnsPage = response.initialTurnsPage;
    return {
      thread: {
        ...response.thread,
        turns: initialTurnsPage?.data
          ? chronologicalTurns(initialTurnsPage.data)
          : response.thread.turns ?? [],
      },
      model: response.model,
      reasoningEffort: response.reasoningEffort,
      serviceTier: response.serviceTier,
      approvalPolicy: response.approvalPolicy,
      approvalsReviewer: response.approvalsReviewer,
      activePermissionProfile: response.activePermissionProfile,
      settingsSynchronized: true,
      nextTurnsCursor: initialTurnsPage?.nextCursor ?? null,
    };
  } catch {
    const response = await client.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    return {
      thread: response.thread,
      settingsSynchronized: false,
      nextTurnsCursor: null,
    };
  }
}
