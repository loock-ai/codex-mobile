import type { RpcMessage } from "../../app-server/client";
import { ActionSheet } from "../../ui/ActionSheet";

type AnyRecord = Record<string, any>;

export function ApprovalSheet({
  approval,
  userAnswers,
  onAnswerChange,
  onSubmitAnswers,
  onDecision,
}: {
  approval: RpcMessage | null;
  userAnswers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmitAnswers: () => void;
  onDecision: (decision: "accept" | "decline") => void;
}) {
  if (!approval) return null;
  const requestsInput = approval.method === "item/tool/requestUserInput";
  const title = requestsInput
    ? "Codex 需要你的回答"
    : approval.method?.includes("fileChange")
      ? "允许修改文件？"
      : approval.method?.includes("permissions")
        ? "授予附加权限？"
        : "允许运行此操作？";
  return (
    <ActionSheet
      title={
        <div>
          <small>需要你的确认</small>
          <h2>{title}</h2>
        </div>
      }
      ariaLabel={title}
      className="approval-sheet"
      backdropClassName="approval-backdrop"
      closeOnBackdrop={false}
      footer={
        requestsInput ? (
          <button className="approve" onClick={onSubmitAnswers}>
            提交回答
          </button>
        ) : (
          <>
            <button onClick={() => onDecision("decline")}>拒绝</button>
            <button className="approve" onClick={() => onDecision("accept")}>
              允许
            </button>
          </>
        )
      }
    >
        {requestsInput ? (
          <>
            {(((approval.params as AnyRecord)?.questions ?? []) as AnyRecord[]).map((question) => (
              <label className="question-field" key={question.id}>
                <strong>{question.header}</strong>
                <span>{question.question}</span>
                {question.options?.length ? (
                  <select value={userAnswers[question.id] ?? ""} onChange={(event) => onAnswerChange(question.id, event.target.value)}>
                    <option value="">请选择</option>
                    {question.options.map((option: AnyRecord) => <option key={option.label} value={option.label}>{option.label}</option>)}
                  </select>
                ) : (
                  <input type={question.isSecret ? "password" : "text"} value={userAnswers[question.id] ?? ""} onChange={(event) => onAnswerChange(question.id, event.target.value)} />
                )}
              </label>
            ))}
          </>
        ) : (
          <pre>{JSON.stringify(approval.params, null, 2)}</pre>
        )}
    </ActionSheet>
  );
}
