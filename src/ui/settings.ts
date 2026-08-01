export type BasicApprovalPolicy = "untrusted" | "on-request" | "never";
export type ApprovalPolicy = BasicApprovalPolicy | Record<string, unknown>;
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type PermissionModeId =
  | "default"
  | "auto-review"
  | "read-only"
  | "full-access";

export interface ModelCatalogEntry {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string | null;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultServiceTier?: string | null;
  serviceTiers?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  additionalSpeedTiers?: string[];
}

export interface PermissionMode {
  id: PermissionModeId;
  label: string;
  description: string;
  permissions: string;
  approvalPolicy: BasicApprovalPolicy;
  approvalsReviewer: ApprovalsReviewer;
}

const effortLabels: Record<string, string> = {
  low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "超高",
};

const permissionProfileLabels: Record<string, string> = {
  ":read-only": "只读",
  ":workspace": "工作区访问",
  ":workspace-write": "工作区访问",
  ":danger-full-access": "完全访问",
  ":full": "完全访问",
  ":default": "默认权限",
};

const approvalPolicyLabels: Record<BasicApprovalPolicy, string> = {
  untrusted: "仅可信操作",
  "on-request": "按需审批",
  never: "永不审批",
};

const approvalPolicyDescriptions: Record<BasicApprovalPolicy, string> = {
  untrusted: "不可信命令执行前需要确认",
  "on-request": "由 Codex 在需要时请求确认",
  never: "不弹出审批，受权限范围约束",
};

export function permissionProfileLabel(id: string, description?: string | null) {
  return t(permissionProfileLabels[id] || description || id.replace(/^:/, "") || "默认权限");
}

export function approvalPolicyLabel(policy: ApprovalPolicy | null | undefined) {
  if (typeof policy === "string") {
    return t(approvalPolicyLabels[policy as BasicApprovalPolicy] || policy);
  }
  return policy ? t("自定义审批") : t("默认审批");
}

export function approvalPolicyDescription(policy: BasicApprovalPolicy) {
  return t(approvalPolicyDescriptions[policy]);
}

export function modelOptionMeta(model: ModelCatalogEntry) {
  const modelId = model.model || model.id || t("未知模型");
  const identity =
    model.id && model.id !== modelId ? `${modelId} · ${model.id}` : modelId;
  return {
    identity,
    description: model.description || "",
  };
}

export function effortOptionsForModel(model: ModelCatalogEntry | null | undefined) {
  return (model?.supportedReasoningEfforts ?? []).map((option) => ({
    id: option.reasoningEffort,
    label: t(effortLabels[option.reasoningEffort] ?? option.reasoningEffort),
    description: option.description,
  }));
}

export function effortLabel(effort: string | null | undefined) {
  return effort ? t(effortLabels[effort] ?? effort) : t("智能");
}

export function speedOptionsForModel(model: ModelCatalogEntry | null | undefined) {
  return [
    {
      id: null as string | null,
      label: t("正常"),
      description: t("默认速度，正常用量"),
    },
    ...(model?.serviceTiers ?? []).map((tier) => ({
      id: tier.id as string | null,
      label: tier.name,
      description: tier.description,
    })),
  ];
}

export function normalizeModelSettings(
  model: ModelCatalogEntry | null | undefined,
  effort: string | null | undefined,
  serviceTier: string | null | undefined,
) {
  const efforts = effortOptionsForModel(model);
  const normalizedEffort =
    efforts.find((option) => option.id === effort)?.id ??
    efforts.find((option) => option.id === model?.defaultReasoningEffort)?.id ??
    efforts[0]?.id ??
    null;
  const tiers = model?.serviceTiers ?? [];
  let normalizedServiceTier =
    tiers.find((tier) => tier.id === serviceTier)?.id ?? null;
  if (
    !normalizedServiceTier &&
    serviceTier === "fast" &&
    model?.additionalSpeedTiers?.includes("fast")
  ) {
    normalizedServiceTier =
      tiers.find((tier) => tier.id === model.defaultServiceTier)?.id ??
      tiers[0]?.id ??
      null;
  }
  if (!normalizedServiceTier && serviceTier != null) {
    normalizedServiceTier =
      tiers.find((tier) => tier.id === model?.defaultServiceTier)?.id ?? null;
  }
  return {
    effort: normalizedEffort,
    serviceTier: normalizedServiceTier,
  };
}

export function permissionModesFromProfiles(
  profiles: Array<{ id: string; allowed?: boolean }>,
): PermissionMode[] {
  const ids = new Set(
    profiles
      .filter((profile) => profile.allowed !== false)
      .map((profile) => profile.id),
  );
  const modes: PermissionMode[] = [];
  if (ids.has(":workspace")) {
    modes.push(
      {
        id: "default",
        label: t("默认权限"),
        description: t("在沙盒中运行命令"),
        permissions: ":workspace",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
      {
        id: "auto-review",
        label: t("自动审核"),
        description: t("自动审查提权请求"),
        permissions: ":workspace",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
      },
    );
  }
  if (ids.has(":read-only")) {
    modes.push({
      id: "read-only",
      label: t("只读"),
      description: t("编辑文件或运行命令需要批准"),
      permissions: ":read-only",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    });
  }
  if (ids.has(":danger-full-access")) {
    modes.push({
      id: "full-access",
      label: t("完全访问权限"),
      description: t("完全访问计算机（风险较高）"),
      permissions: ":danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
  }
  return modes;
}

export function permissionModeFromSettings(
  permissions: string | null | undefined,
  approvalPolicy: ApprovalPolicy | null | undefined,
  approvalsReviewer: ApprovalsReviewer | null | undefined,
): PermissionModeId | null {
  if (
    permissions === ":workspace" &&
    approvalPolicy === "on-request" &&
    approvalsReviewer === "auto_review"
  ) {
    return "auto-review";
  }
  if (
    permissions === ":danger-full-access" &&
    approvalPolicy === "never"
  ) {
    return "full-access";
  }
  if (permissions === ":read-only") return "read-only";
  if (permissions === ":workspace") return "default";
  return null;
}

export const approvalPolicyOptions: BasicApprovalPolicy[] = [
  "untrusted",
  "on-request",
  "never",
];
import { t } from "../i18n";
