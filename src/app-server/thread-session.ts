import type {
  ApprovalPolicy,
  ApprovalsReviewer,
} from "../ui/settings";

type AnyRecord = Record<string, any>;

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
}

export async function resumeThreadSession(
  client: Requester,
  threadId: string,
): Promise<ResumedThreadSession> {
  try {
    const response = await client.request("thread/resume", { threadId });
    return {
      thread: response.thread,
      model: response.model,
      reasoningEffort: response.reasoningEffort,
      serviceTier: response.serviceTier,
      approvalPolicy: response.approvalPolicy,
      approvalsReviewer: response.approvalsReviewer,
      activePermissionProfile: response.activePermissionProfile,
      settingsSynchronized: true,
    };
  } catch {
    const response = await client.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    return {
      thread: response.thread,
      settingsSynchronized: false,
    };
  }
}
