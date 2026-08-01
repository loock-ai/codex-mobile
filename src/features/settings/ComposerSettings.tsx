import { Chevron } from "../../ui/icons";
import { t } from "../../i18n";
import {
  modelOptionMeta,
  type ModelCatalogEntry,
  type PermissionMode,
  type PermissionModeId,
} from "../../ui/settings";

export type ComposerPicker =
  | "agent"
  | "model"
  | "speed"
  | "permission"
  | null;

export function ComposerSettings({
  picker,
  effortOptions,
  speedOptions,
  permissionModes,
  models,
  selectedEffort,
  selectedModel,
  selectedModelLabel,
  selectedServiceTier,
  selectedSpeedLabel,
  selectedPermissionModeId,
  onPickerChange,
  onChooseEffort,
  onChooseModel,
  onChooseSpeed,
  onChoosePermissionMode,
}: {
  picker: ComposerPicker;
  effortOptions: Array<{ id: string; label: string; description?: string }>;
  speedOptions: Array<{ id: string | null; label: string; description: string }>;
  permissionModes: PermissionMode[];
  models: ModelCatalogEntry[];
  selectedEffort: string | null;
  selectedModel: string;
  selectedModelLabel: string;
  selectedServiceTier: string | null;
  selectedSpeedLabel: string;
  selectedPermissionModeId: PermissionModeId | null;
  onPickerChange: (picker: ComposerPicker) => void;
  onChooseEffort: (effort: string) => void;
  onChooseModel: (model: string) => void;
  onChooseSpeed: (serviceTier: string | null) => void;
  onChoosePermissionMode: (mode: PermissionModeId) => void;
}) {
  if (!picker) return null;
  return (
    <div className="composer-popover-backdrop" onClick={() => onPickerChange(null)}>
      <section
        className={`composer-popover ${picker === "permission" ? "permission-popover" : ""}`}
        aria-label={
          picker === "permission"
            ? t("权限模式")
            : picker === "model"
              ? t("模型")
              : picker === "speed"
                ? t("速度")
                : t("智能")
        }
        onClick={(event) => event.stopPropagation()}
      >
        {picker === "agent" && (
          <>
            <div className="popover-eyebrow">{t("智能")}</div>
            <div className="popover-options effort-options">
              {effortOptions.map((option) => {
                const selected = option.id === selectedEffort;
                return (
                  <button
                    key={option.id}
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    onClick={() => {
                      onChooseEffort(option.id);
                      onPickerChange(null);
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                    <i>{selected ? "✓" : ""}</i>
                  </button>
                );
              })}
            </div>
            <div className="popover-divider" />
            <button className="popover-link" onClick={() => onPickerChange("model")}>
              <span><strong>{t("模型")}</strong><small>{selectedModelLabel}</small></span>
              <Chevron />
            </button>
            <button className="popover-link" onClick={() => onPickerChange("speed")}>
              <span><strong>{t("速度")}</strong><small>{selectedSpeedLabel}</small></span>
              <Chevron />
            </button>
          </>
        )}
        {picker === "model" && (
          <>
            <button className="popover-title" onClick={() => onPickerChange("agent")}>
              <span><strong>{t("模型")}</strong><small>{selectedModelLabel}</small></span>
              <Chevron direction="down" />
            </button>
            <div className="popover-divider" />
            <div className="popover-options model-options" aria-label={t("模型列表")}>
              {models.map((option) => {
                const value = option.model;
                const selected = value === selectedModel;
                const meta = modelOptionMeta(option);
                return (
                  <button
                    key={option.id || value}
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    onClick={() => {
                      onChooseModel(value as string);
                      onPickerChange(null);
                    }}
                  >
                    <span>
                      <strong>{option.displayName}</strong>
                      <small>{meta.description || meta.identity}</small>
                    </span>
                    <i>{selected ? "✓" : ""}</i>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {picker === "speed" && (
          <>
            <button className="popover-title" onClick={() => onPickerChange("agent")}>
              <span><strong>{t("速度")}</strong><small>{selectedSpeedLabel}</small></span>
              <Chevron direction="down" />
            </button>
            <div className="popover-divider" />
            <div className="popover-options" aria-label={t("速度列表")}>
              {speedOptions.map((option) => {
                const selected = option.id === selectedServiceTier;
                return (
                  <button
                    key={option.id ?? "normal"}
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    onClick={() => {
                      onChooseSpeed(option.id);
                      onPickerChange(null);
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <i>{selected ? "✓" : ""}</i>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {picker === "permission" && (
          <div className="popover-options permission-options">
            {permissionModes.map((mode) => {
              const selected = mode.id === selectedPermissionModeId;
              return (
                <button
                  key={mode.id}
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() => onChoosePermissionMode(mode.id)}
                >
                  <span>
                    <strong>{mode.label}</strong>
                    <small>{mode.description}</small>
                  </span>
                  <i>{selected ? "✓" : ""}</i>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
