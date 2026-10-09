import type {
  ApprovalPolicy,
  ApprovalsReviewer,
} from "../ui/settings";

type AnyRecord = Record<string, any>;
const initialTurnsLimit = 10;

interface Requester {
  backend?: string;
  request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<any>;
}

export interface ResumedThreadSession {
  thread: AnyRecord;
  accessMode: ThreadAccessMode;
  resumeError?: string;
  model?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: ApprovalsReviewer;
  activePermissionProfile?: { id: string } | null;
  settingsSynchronized: boolean;
  nextTurnsCursor: string | null;
}

export type ThreadAccessMode = "interactive" | "readOnly";

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

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isActiveWriterConflict(reason: unknown) {
  return errorMessage(reason).includes("already has an active writer");
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
  if(client.backend==='desktop-control')return loadControlTurns(client,threadId,cursor);
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

export async function loadRecentThreadTurns(
  client: Requester,
  threadId: string,
): Promise<AnyRecord[]> {
  if(client.backend==='desktop-control')return (await loadControlTurns(client,threadId)).turns;
  const response = await client.request("thread/turns/list", {
    threadId,
    limit: initialTurnsLimit,
    sortDirection: "desc",
    itemsView: "full",
  });
  return chronologicalTurns(response.data);
}

export async function loadStableRecentThreadTurns(
  client: Requester,
  threadId: string,
  readNotificationSequence: () => number,
  maxAttempts = 3,
): Promise<AnyRecord[] | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sequence = readNotificationSequence();
    const turns = await loadRecentThreadTurns(client, threadId);
    if (sequence === readNotificationSequence()) return turns;
  }
  return null;
}

export async function loadRecoverableRecentThreadTurns(
  client: Requester,
  threadId: string,
  readNotificationSequence: () => number,
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)),
  maxAttempts = 3,
): Promise<AnyRecord[] | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const turns = await loadStableRecentThreadTurns(
        client,
        threadId,
        readNotificationSequence,
      );
      if (turns != null) return turns;
    } catch {
      // 快照读取失败不代表 WebSocket 已断开；先在当前连接上限次重试。
    }
    if (attempt < maxAttempts - 1) {
      await wait(300 * 2 ** attempt);
    }
  }
  return null;
}

export async function resumeThreadSession(
  client: Requester,
  threadId: string,
  isCurrent: () => boolean = () => true,
): Promise<ResumedThreadSession> {
  try {
    if(client.backend==='desktop-control'){
      await client.request('desktop/subscribe',{threadIds:[threadId]});
      if(!isCurrent())throw Object.assign(new Error('会话已切换，恢复请求已取消'),{code:'STALE_RESUME'});
      const response=await client.request('thread/resume',{threadId,excludeTurns:true},{timeoutMs:60000});
      if(!isCurrent())throw Object.assign(new Error('会话已切换，恢复请求已取消'),{code:'STALE_RESUME'});
      const page=await loadControlTurns(client,threadId);
      return {thread:{...response.thread,turns:page.turns},model:response.model,reasoningEffort:response.reasoningEffort,accessMode:'interactive',settingsSynchronized:false,nextTurnsCursor:page.nextCursor};
    }
    const response = await client.request(
      "thread/resume",
      {
        threadId,
        excludeTurns: true,
        initialTurnsPage: {
          limit: initialTurnsLimit,
          sortDirection: "desc",
          itemsView: "full",
        },
      },
      { timeoutMs: 60_000 },
    );
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
      accessMode: "interactive",
      settingsSynchronized: true,
      nextTurnsCursor: initialTurnsPage?.nextCursor ?? null,
    };
  } catch (reason) {
    if (!isActiveWriterConflict(reason)) throw reason;
    const resumeError = errorMessage(reason);
    const response = await client.request("thread/read", {
      threadId,
      includeTurns: false,
    });
    const turnsPage = await client.request("thread/turns/list", {
      threadId,
      limit: initialTurnsLimit,
      sortDirection: "desc",
      itemsView: "full",
    });
    return {
      thread: {
        ...response.thread,
        turns: chronologicalTurns(turnsPage.data),
      },
      accessMode: "readOnly",
      resumeError,
      settingsSynchronized: false,
      nextTurnsCursor: turnsPage.nextCursor ?? null,
    };
  }
}

async function loadControlTurns(client:Requester,threadId:string,cursor?:string):Promise<ThreadTurnsPage>{
  const page=await client.request('thread/turns/list',{threadId,cursor:cursor??null,limit:initialTurnsLimit,sortDirection:'desc',itemsView:'notLoaded'});
  const turns:AnyRecord[]=[];
  for(const turn of chronologicalTurns(page.data)){
    const items:AnyRecord[]=[],seen=new Set<string>(),itemIds=new Set<string>();let next:string|null=null,limit=20;
    for(let pages=0;;pages++){
      if(pages>=1000)throw new Error('消息分页超过限制');
      let result:any;
      for(;;){try{result=await client.request('thread/items/list',{threadId,turnId:turn.id,cursor:next,limit,sortDirection:'asc'});break;}catch(error){if(limit>1&&((error as {code?:string})?.code==='RESPONSE_TOO_LARGE'||errorMessage(error).includes('decoded message length too large'))){limit=Math.max(1,Math.floor(limit/2));continue;}throw error;}}
      for(const entry of result.data??[]){
        if(entry.item&&entry.turnId!==turn.id)throw new Error('消息返回了不匹配的回合');
        const item=entry.item??entry;
        if(!itemIds.has(item.id)){itemIds.add(item.id);items.push(item);}
      }
      next=result.nextCursor??null;if(!next)break;if(seen.has(next))throw new Error('消息分页游标重复');seen.add(next);
    }
    turns.push({...turn,items,itemsView:'full'});
  }
  return {turns,nextCursor:page.nextCursor??null};
}


export async function reconcileDesktopTurnsAfterResume(
  client: Requester,
  threadId: string,
  sequenceAtResumeStart: number,
  readSequence: () => number,
  resumedTurns: AnyRecord[],
): Promise<AnyRecord[]> {
  if (client.backend !== "desktop-control" || sequenceAtResumeStart === readSequence()) return resumedTurns;
  // 页面提交快照时合并加载期间观察到的实时状态，不要求活跃会话静默。
  return loadRecentThreadTurns(client,threadId);
}
