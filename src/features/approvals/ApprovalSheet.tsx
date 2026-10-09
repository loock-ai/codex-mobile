import type { RpcMessage } from "../../app-server/client";
import { ActionSheet } from "../../ui/ActionSheet";
import { UserQuestionFields } from "./UserQuestionFields";
import { isNonBlockingQuestion, hasQuestionAnswers } from "./user-questions";
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
  submissionUnknown = false,
}: {
  approval: RpcMessage | null;
  userAnswers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmitAnswers: () => void;
  onDesktopChoice?: (choice: string) => void;
  submitting?: boolean;
  submissionError?: string;
  submissionUnknown?: boolean;
  onDecision: (decision: "accept" | "decline") => void;
}) {
  if (!approval || isNonBlockingQuestion(approval)) return null;
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
          <>{(desktopApproval.options ?? []).map((option: AnyRecord) => <button disabled={submitting || submissionUnknown} key={option.id} onClick={() => onDesktopChoice?.(option.id)}>{option.label}</button>)}</>
        ) : requestsInput ? (
          <button disabled={submitting || submissionUnknown || !hasQuestionAnswers(approval,userAnswers)} className="approve" onClick={onSubmitAnswers}>
            {t("提交回答")}
          </button>
        ) : (
          <>
            <button disabled={submitting || submissionUnknown} onClick={() => onDecision("decline")}>{t("拒绝")}</button>
            <button disabled={submitting || submissionUnknown} className="approve" onClick={() => onDecision("accept")}>
              {t("允许")}
            </button>
          </>
        )
      }
    >
        {submissionError && <p role="alert">{submissionError}</p>}
        {desktopApproval ? <pre>{desktopApproval.text}</pre> : requestsInput ? (
          <UserQuestionFields request={approval} answers={userAnswers} disabled={submitting || submissionUnknown} onChange={onAnswerChange} />
        ) : (
          <pre>{JSON.stringify(approval.params, null, 2)}</pre>
        )}
    </ActionSheet>
  );
}
