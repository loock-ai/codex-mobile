import type { RpcMessage } from '../../app-server/client';
export interface UserQuestion { id: string; header?: string; question: string; isSecret?: boolean; options?: {label:string;description?:string}[] }
export function requestParams(request: RpcMessage): Record<string, any> { return (request.params ?? {}) as Record<string, any>; }
export function userQuestions(request: RpcMessage): UserQuestion[] {
  const questions = requestParams(request).questions;
  return Array.isArray(questions) ? questions.filter(question => question && typeof question.id === 'string' && typeof question.question === 'string') : [];
}
export function isNonBlockingQuestion(request: RpcMessage) { return request.method === 'item/tool/requestUserInput' && requestParams(request).isBlocking === false; }
export function questionRequestKey(request: RpcMessage) {
  const params = requestParams(request);
  return JSON.stringify([params.hostId ?? '', params.threadId ?? '', request.id, userQuestions(request).map(question => question.id)]);
}
export function selectVisibleRequests(requests: RpcMessage[], threadId: string, hostId?: string): {approval:RpcMessage|null;question:RpcMessage|null} {
  const visible = requests.filter(request => {
    const params = requestParams(request);
    if (params.threadId && String(params.threadId) !== threadId) return false;
    if (request.method === 'item/tool/requestUserInput' && (!threadId || String(params.threadId ?? '') !== threadId)) return false;
    return !hostId || !params.hostId || String(params.hostId) === hostId;
  });
  const question = visible.find(isNonBlockingQuestion) ?? null;
  const modal = visible.filter(request => !isNonBlockingQuestion(request));
  return { question, approval: modal.find(request => request.method !== 'item/tool/requestUserInput') ?? modal[0] ?? null };
}
export function buildQuestionAnswers(request: RpcMessage, answers: Record<string,string>) {
  return { answers: Object.fromEntries(userQuestions(request).map(question => [question.id, { answers: [answers[question.id] ?? ''] }])) };
}
export function hasQuestionAnswers(request: RpcMessage, answers: Record<string,string>) {
  const questions = userQuestions(request);
  return questions.length > 0 && questions.every(question => Boolean(answers[question.id]?.trim()));
}
export function isUnknownWrite(reason: unknown) { return (reason as {code?:string})?.code === 'ACTION_WRITE_UNKNOWN'; }
