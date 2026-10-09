import { describe, expect, it, vi } from "vitest";
import {
  loadRecoverableRecentThreadTurns,
  loadRecentThreadTurns,
  loadStableRecentThreadTurns,
  loadOlderThreadTurns,
  prependUniqueTurns,
  resumeThreadSession,
  reconcileDesktopTurnsAfterResume,
} from "../../src/app-server/thread-session";

describe("恢复已有 app-server 会话", () => {
  it('持续产生事件时仍能返回历史快照，不要求整个会话静默',async()=>{
    let sequence=1;
    const client={backend:'desktop-control',request:async(method:string)=>{sequence++;return method==='thread/turns/list'?{data:[{id:'t',status:'inProgress'}],nextCursor:null}:{data:[{id:'a',type:'agentMessage',text:'快照'}],nextCursor:null};}};
    const turns=await reconcileDesktopTurnsAfterResume(client,'thread',0,()=>sequence,[]);
    expect(turns[0].items[0].text).toBe('快照');
  });
  it('切换会话后，迟到的订阅响应不能再恢复旧会话',async()=>{
    let current='a',release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;});const resumed:string[]=[];
    const client={backend:'desktop-control',request:async(method:string,p:any)=>{
      if(method==='desktop/subscribe'){if(p.threadIds[0]==='a')await delayed;return {};}
      if(method==='thread/resume'){resumed.push(p.threadId);return {thread:{id:p.threadId}};}
      return {data:[],nextCursor:null};
    }};
    const stale=resumeThreadSession(client,'a',()=>current==='a');const rejected=expect(stale).rejects.toThrow();
    current='b';await resumeThreadSession(client,'b',()=>current==='b');release();await rejected;expect(resumed).toEqual(['b']);
  });
  it('历史加载期间收到回复增量时，以最新桌面快照为准', async () => {
    let sequence=2;const calls:string[]=[];
    const client={backend:'desktop-control',request:async(method:string,params:any)=>{calls.push(method);if(method==='thread/turns/list')return {data:[{id:'turn-new',status:'completed',itemsView:'notLoaded'}],nextCursor:null};if(method==='thread/items/list')return {data:[{turnId:'turn-new',item:{id:'answer',type:'agentMessage',text:'新回复'}}],nextCursor:null};throw new Error(method);}};
    const turns=await reconcileDesktopTurnsAfterResume(client,'thread-1',1,()=>sequence,[{id:'turn-old'}]);
    expect(turns.map((turn:any)=>turn.id)).toEqual(['turn-new']);expect(calls).toContain('thread/items/list');
    sequence=1;const stable=await reconcileDesktopTurnsAfterResume(client,'thread-1',1,()=>sequence,[{id:'kept'}]);expect(stable).toEqual([{id:'kept'}]);
  });
  it('桌面模式订阅会话并读取每个回合的完整分页，不覆盖桌面设置',async()=>{
    const calls:any[]=[];
    const client={backend:'desktop-control',request:async(method:string,params:any)=>{
      calls.push({method,params});
      if(method==='desktop/subscribe')return {};
      if(method==='thread/resume')return {thread:{id:'t',cwd:'/project'},model:'desktop-model'};
      if(method==='thread/turns/list')return {data:[{id:'turn'}],nextCursor:'older'};
      if(method==='thread/items/list')return params.cursor?{data:[{id:'a',type:'agentMessage',text:'回复'}],nextCursor:null}:{data:[{id:'u',type:'userMessage'}],nextCursor:'items2'};
      throw new Error(method);
    }};
    const session=await resumeThreadSession(client,'t');
    expect(session.thread.turns[0].items.map((x:any)=>x.id)).toEqual(['u','a']);
    expect(session.nextTurnsCursor).toBe('older');expect(session.settingsSynchronized).toBe(false);
    expect(calls[0]).toEqual({method:'desktop/subscribe',params:{threadIds:['t']}});
  });
  it("优先 thread/resume 并返回线程的有效设置", async () => {
    const request = vi.fn().mockResolvedValue({
      thread: { id: "thread-1", turns: [] },
      initialTurnsPage: {
        data: [
          { id: "turn-2", items: [{ id: "item-2" }] },
          { id: "turn-1", items: [{ id: "item-1" }] },
        ],
        nextCursor: "older-cursor",
      },
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      serviceTier: "priority",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      activePermissionProfile: { id: ":workspace" },
    });

    const result = await resumeThreadSession({ request }, "thread-1");

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "thread/resume",
      {
        threadId: "thread-1",
        excludeTurns: true,
        initialTurnsPage: {
          limit: 10,
          sortDirection: "desc",
          itemsView: "full",
        },
      },
      { timeoutMs: 60_000 },
    );
    expect(result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextTurnsCursor).toBe("older-cursor");
    expect(result.accessMode).toBe("interactive");
    expect(result.resumeError).toBeUndefined();
    expect(result.settingsSynchronized).toBe(true);
    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.reasoningEffort).toBe("high");
    expect(result.serviceTier).toBe("priority");
    expect(result.approvalPolicy).toBe("on-request");
    expect(result.approvalsReviewer).toBe("auto_review");
    expect(result.activePermissionProfile?.id).toBe(":workspace");
  });

  it("resume 被其他写入者占用时使用只读分页接口恢复", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("thread-store conflict: thread already has an active writer"),
      )
      .mockResolvedValueOnce({
        thread: { id: "thread-1", title: "Paginated thread" },
      })
      .mockResolvedValueOnce({
        data: [{ id: "turn-2" }, { id: "turn-1" }],
        nextCursor: "older-cursor",
      });

    const result = await resumeThreadSession({ request }, "thread-1");

    expect(request).toHaveBeenNthCalledWith(2, "thread/read", {
      threadId: "thread-1",
      includeTurns: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "thread/turns/list", {
      threadId: "thread-1",
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result.settingsSynchronized).toBe(false);
    expect(result.thread.id).toBe("thread-1");
    expect(result.thread.turns.map((turn: { id: string }) => turn.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextTurnsCursor).toBe("older-cursor");
    expect(result.accessMode).toBe("readOnly");
    expect(result.resumeError).toContain("active writer");
    expect(request).not.toHaveBeenCalledWith("thread/read", {
      threadId: "thread-1",
      includeTurns: true,
    });
  });

  it("resume 的非 writer 错误保留原始原因且不读取历史", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("app-server connection closed"));

    await expect(
      resumeThreadSession({ request }, "thread-1"),
    ).rejects.toThrow("app-server connection closed");

    expect(request).toHaveBeenCalledOnce();
  });

  it("使用游标获取更早 turns 并转换为时间正序", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ id: "turn-2" }, { id: "turn-1" }],
      nextCursor: "next-older",
    });

    const result = await loadOlderThreadTurns(
      { request },
      "thread-1",
      "older-cursor",
    );

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "thread-1",
      cursor: "older-cursor",
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result.turns.map((turn) => String(turn.id))).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(result.nextCursor).toBe("next-older");
  });

  it("获取最新完整 turns 用于回到前台后的增量对账", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        { id: "turn-3", status: "completed" },
        { id: "turn-2", status: "completed" },
      ],
      nextCursor: "older",
    });

    const result = await loadRecentThreadTurns(
      { request },
      "thread-1",
    );

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "thread-1",
      limit: 10,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result.map((turn) => turn.id)).toEqual(["turn-2", "turn-3"]);
  });

  it("对账请求期间收到实时事件时重新读取稳定快照", async () => {
    let notificationSequence = 0;
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        notificationSequence += 1;
        return { data: [{ id: "turn-stale" }] };
      })
      .mockResolvedValueOnce({ data: [{ id: "turn-current" }] });

    const result = await loadStableRecentThreadTurns(
      { request },
      "thread-1",
      () => notificationSequence,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(result?.map((turn) => turn.id)).toEqual(["turn-current"]);
  });

  it("前台恢复快照短暂失败时按退避重试且不要求重连", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ data: [{ id: "turn-current" }] });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await loadRecoverableRecentThreadTurns(
      { request },
      "thread-1",
      () => 0,
      wait,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(300);
    expect(result?.map((turn) => turn.id)).toEqual(["turn-current"]);
  });

  it("向前插入分页结果时按 id 去重且保留现有实时 turn", () => {
    expect(
      prependUniqueTurns(
        [{ id: "turn-2" }, { id: "turn-3", status: "running" }],
        [{ id: "turn-1" }, { id: "turn-2", status: "completed" }],
      ),
    ).toEqual([
      { id: "turn-1" },
      { id: "turn-2" },
      { id: "turn-3", status: "running" },
    ]);
  });
});
