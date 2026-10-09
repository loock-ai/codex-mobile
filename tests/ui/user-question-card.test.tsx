import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RpcMessage } from '../../src/app-server/client';
import { UserQuestionCard } from '../../src/features/approvals/UserQuestionCard';
import { selectVisibleRequests, questionRequestKey } from '../../src/features/approvals/user-questions';
import { ApprovalSheet } from '../../src/features/approvals/ApprovalSheet';
const request = (id = 'host:1', isBlocking = false): RpcMessage => ({ id, method: 'item/tool/requestUserInput', params: { threadId: 't1', hostId: 'local', isBlocking, questions: [{ id: 'q1', header: '方向', question: '选择处理方式', options: [{ label: '快速', description: '先做最小修改' }] }] } });
afterEach(cleanup);
describe('非阻塞用户问题', () => {
  it('权限模态优先，非阻塞问题另选，隔离其他线程和主机', () => {
    const background = request();
    const permission = { id: 'host:2', method: 'item/commandExecution/requestApproval', params: { threadId: 't1', hostId: 'local' } };
    const other = { ...request('remote:1'), params: { ...(request().params as object), hostId: 'remote' } };
    const result = selectVisibleRequests([other, background, permission], 't1', 'local');
    expect(result.approval).toBe(permission);
    expect(result.question).toBe(background);
    expect(selectVisibleRequests([background], 'other', 'local')).toEqual({ approval: null, question: null });
    expect(questionRequestKey(background)).not.toBe(questionRequestKey(other));
  });
  it('显示可收起卡片而非模态，选项问题仍允许自由文字', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<><textarea aria-label="聊天输入" /><UserQuestionCard request={request()} onSubmit={submit} /></>);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: '选择处理方式' }), { target: { value: '快速' } });
    fireEvent.change(screen.getByRole('textbox', { name: '其他回答' }), { target: { value: '先检查已有实现' } });
    fireEvent.change(screen.getByRole('textbox', { name: '聊天输入' }), { target: { value: '继续工作' } });
    expect(screen.getByRole('textbox', { name: '聊天输入' })).toHaveValue('继续工作');
    fireEvent.click(screen.getByRole('button', { name: '收起问题' }));
    expect(screen.queryByRole('textbox', { name: '其他回答' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开问题' }));
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ answers: { q1: { answers: ['先检查已有实现'] } } }));
  });
  it('请求换ID后不沿用旧答案，普通失败可重试，未知结果锁定提交', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('暂时失败')).mockRejectedValueOnce(Object.assign(new Error('未确认'), { code: 'ACTION_WRITE_UNKNOWN' }));
    const view = render(<UserQuestionCard request={request()} onSubmit={submit} />);
    fireEvent.change(screen.getByRole('textbox', { name: '其他回答' }), { target: { value: '答案' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    await screen.findByText('暂时失败');
    expect(screen.getByRole('button', { name: '提交回答' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    await screen.findByText(/回答结果未确认/);
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled();
    view.rerender(<UserQuestionCard request={request('host:next')} onSubmit={submit} />);
    expect(screen.getByRole('textbox', { name: '其他回答' })).toHaveValue('');
  });
  it('非阻塞问题不会误显示为审批模态', () => {
    render(<ApprovalSheet approval={request()} userAnswers={{}} onAnswerChange={() => {}} onSubmitAnswers={() => {}} onDecision={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('明确阻塞的问题保持模态，选项之外可输入其他答案', () => {
  const answer = vi.fn();
  render(<ApprovalSheet approval={request('blocking',true)} userAnswers={{q1:'自定义'}} onAnswerChange={answer} onSubmitAnswers={() => {}} onDecision={() => {}} />);
  expect(screen.getByRole('dialog', {name:'Codex 需要你的回答'})).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox',{name:'其他回答'}),{target:{value:'改用另一个方案'}});
  expect(answer).toHaveBeenCalledWith('q1','改用另一个方案');
});

it('同一请求中的问题 ID 改变时清空之前的答案', () => {
  const view=render(<UserQuestionCard request={request()} onSubmit={async()=>{}}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'其他回答'}),{target:{value:'旧答案'}});
  const next=request();
  (next.params as any).questions[0].id='different-question';
  view.rerender(<UserQuestionCard request={next} onSubmit={async()=>{}}/>);
  expect(screen.getByRole('textbox',{name:'其他回答'})).toHaveValue('');
});

it('重新进入已有未知回执的问题时立即禁止再次提交', () => {
  const submit=vi.fn();
  render(<UserQuestionCard request={request()} onSubmit={submit} submissionState="unknown"/>);
  expect(screen.getByText(/回答结果未确认/)).toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'其他回答'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'提交回答'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'提交回答'}));
  expect(submit).not.toHaveBeenCalled();
});

it('提交未结束时锁定重复操作，输出更新不清空问题草稿', async () => {
  let finish!:()=>void;
  const submit=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(<><p>输出一</p><UserQuestionCard request={request()} onSubmit={submit}/></>);
  fireEvent.change(screen.getByRole('textbox',{name:'其他回答'}),{target:{value:'保持这个回答'}});
  view.rerender(<><p>输出继续追加</p><UserQuestionCard request={request()} onSubmit={submit}/></>);
  expect(screen.getByRole('textbox',{name:'其他回答'})).toHaveValue('保持这个回答');
  fireEvent.click(screen.getByRole('button',{name:'提交回答'}));
  fireEvent.click(screen.getByRole('button',{name:'正在提交回答…'}));
  expect(submit).toHaveBeenCalledTimes(1);
  finish();
  await screen.findByText('回答已提交');
});
