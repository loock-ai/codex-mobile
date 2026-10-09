import { useRef, useState } from 'react';
import type { RpcMessage } from '../../app-server/client';
import { t } from '../../i18n';
import { UserQuestionFields } from './UserQuestionFields';
import { buildQuestionAnswers, hasQuestionAnswers, isUnknownWrite, questionRequestKey } from './user-questions';
type Props = {submissionState?:'pending'|'unknown'|'submitted';request:RpcMessage;onSubmit:(result:unknown)=>Promise<unknown>};
export function UserQuestionCard(props:Props) { return <QuestionCardBody key={questionRequestKey(props.request)} {...props} />; }
function QuestionCardBody({request,onSubmit,submissionState}:Props) {
  const [answers,setAnswers] = useState<Record<string,string>>({});
  const [collapsed,setCollapsed] = useState(false);
  const [pending,setPending] = useState(submissionState === 'pending');
  const [completed,setCompleted] = useState(submissionState === 'submitted');
  const [unknown,setUnknown] = useState(submissionState === 'unknown');
  const [error,setError] = useState(submissionState === 'unknown' ? t('回答结果未确认，请在桌面核对，不要重复提交。') : '');
  const locked = useRef(Boolean(submissionState));
  async function submit() {
    if (locked.current || !hasQuestionAnswers(request,answers)) return;
    locked.current = true; setPending(true); setError('');
    try { await onSubmit(buildQuestionAnswers(request,answers)); setCompleted(true); }
    catch (reason) {
      const uncertain = isUnknownWrite(reason);
      setUnknown(uncertain);
      setError(uncertain ? t('回答结果未确认，请在桌面核对，不要重复提交。') : reason instanceof Error ? reason.message : String(reason));
      if (!uncertain) locked.current = false;
    } finally { setPending(false); }
  }
  return <section className="user-question-card" aria-label={t('Codex 有个问题')}>
    <header><div><strong>{t('Codex 有个问题')}</strong><small>{t('任务会继续，你可以稍后回答。')}</small></div><button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? t('展开问题') : t('收起问题')}</button></header>
    {!collapsed && <div className="user-question-card-body"><UserQuestionFields request={request} answers={answers} disabled={pending || unknown || completed} onChange={(id,value) => setAnswers(previous => ({...previous,[id]:value}))} />
      {error && <p role="alert">{error}</p>}
      {completed ? <p role="status">{t('回答已提交')}</p> : <button type="button" className="user-question-submit" disabled={pending || unknown || !hasQuestionAnswers(request,answers)} onClick={() => void submit()}>{pending ? t('正在提交回答…') : t('提交回答')}</button>}
    </div>}
  </section>;
}
