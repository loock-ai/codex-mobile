import type { RpcMessage } from '../../app-server/client';
import { t } from '../../i18n';
import { userQuestions } from './user-questions';
import './user-questions.css';
export function UserQuestionFields({ request, answers, onChange, disabled = false }: { request: RpcMessage; answers: Record<string,string>; onChange: (id:string,value:string)=>void; disabled?:boolean }) {
  return <div className="user-question-fields">{userQuestions(request).map(question => {
    const value = answers[question.id] ?? '';
    const options = Array.isArray(question.options) ? question.options.filter(option => typeof option.label === 'string') : [];
    const selected = options.find(option => option.label === value);
    return <fieldset key={question.id} disabled={disabled}>
      <legend>{question.header || question.question}</legend>
      {question.header && <p>{question.question}</p>}
      {options.length > 0 && <><select aria-label={question.question} value={selected ? value : ''} onChange={event => onChange(question.id,event.target.value)}><option value="">{t('请选择')}</option>{options.map(option => <option key={option.label} value={option.label}>{option.label}</option>)}</select>{selected?.description && <small>{selected.description}</small>}</>}
      <label><span>{options.length ? t('其他回答') : question.question}</span><input type={question.isSecret ? 'password' : 'text'} value={value} onChange={event => onChange(question.id,event.target.value)} autoComplete="off" /></label>
    </fieldset>;
  })}</div>;
}
