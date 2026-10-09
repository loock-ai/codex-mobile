import type { RpcMessage } from "../../app-server/client";
import { ActionSheet } from "../../ui/ActionSheet";
import { t } from "../../i18n";

type AnyRecord = Record<string, any>;

export function ApprovalSheet({
  approval,
  userAnswers,
  onAnswerChange,
  onSubmitAnswers,
  onDecision,
  onDesktopChoice,
  submitting = false,
  submissionError = "",
}: {
  approval: RpcMessage | null;
  userAnswers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmitAnswers: () => void;
  onDesktopChoice?: (choice: string) => void;
  submitting?: boolean;
  submissionError?: string;
  onDecision: (decision: "accept" | "decline") => void;
}) {
  if (!approval) return null;
  const desktopApproval = (approval.params as AnyRecord)?.desktopApproval;
  const requestsInput = approval.method === "item/tool/requestUserInput";
  const title = requestsInput
    ? t("Codex 需要你的回答")
    : approval.method?.includes("fileChange")
      ? t("允许修改文件？")
      : approval.method?.includes("permissions")
        ? t("授予附加权限？")
        : t("允许运行此操作？");
  return (
    <ActionSheet
      title={
        <div>
          <small>{t("需要你的确认")}</small>
          <h2>{title}</h2>
        </div>
      }
      ariaLabel={title}
      className="approval-sheet"
      backdropClassName="approval-backdrop"
      closeOnBackdrop={false}
      footer={
        desktopApproval ? (
          <>{(desktopApproval.options ?? []).map((option: AnyRecord) => <button disabled={submitting} key={option.id} onClick={() => onDesktopChoice?.(option.id)}>{option.label}</button>)}</>
        ) : requestsInput ? (
          <button disabled={submitting} className="approve" onClick={onSubmitAnswers}>
            {t("提交回答")}
          </button>
        ) : (
          <>
            <button disabled={submitting} onClick={() => onDecision("decline")}>{t("拒绝")}</button>
            <button disabled={submitting} className="approve" onClick={() => onDecision("accept")}>
              {t("允许")}
            </button>
          </>
        )
      }
    >
        {submissionError && <p role="alert">{submissionError}</p>}
        {desktopApproval ? <pre>{desktopApproval.text}</pre> : requestsInput ? (
          <>
            {(((approval.params as AnyRecord)?.questions ?? []) as AnyRecord[]).map((question) => (
              <label className="question-field" key={question.id}>
                <strong>{question.header}</strong>
                <span>{question.question}</span>
                {question.options?.length ? (
                  <select value={userAnswers[question.id] ?? ""} onChange={(event) => onAnswerChange(question.id, event.target.value)}>
                    <option value="">{t("请选择")}</option>
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
