import { useState } from "react";
import {
  parseUnifiedDiff,
  summarizeFileChange,
} from "../../../ui/conversation";
import { ActionSheet } from "../../../ui/ActionSheet";
import { t } from "../../../i18n";
import { Chevron } from "../../../ui/icons";

type AnyRecord = Record<string, any>;

export function ToolDetailSheet({
  item,
  onClose,
}: {
  item: AnyRecord;
  onClose: () => void;
}) {
  const isCommand = item.type === "commandExecution";
  const isFile = item.type === "fileChange";
  const title = isCommand
    ? t("命令执行")
    : isFile
      ? t("文件修改")
      : item.type === "collabAgentToolCall"
        ? t("智能体调用")
        : t("工具调用");
  const output =
    item.aggregatedOutput ??
    item.result ??
    item.error ??
    item.contentItems ??
    (isFile ? item.changes : null);
  return (
    <ActionSheet
      title={title}
      onClose={onClose}
      closeLabel={t("关闭工具详情")}
      tone="soft"
      className="tool-detail-sheet"
      backdropClassName="tool-detail-backdrop"
    >
        {isCommand && (
          <>
            <h4>{t("命令")}</h4>
            <code className="detail-command">{item.command}</code>
          </>
        )}
        {isFile && (
          <>
            <h4>{t("文件")}</h4>
            <div className="detail-file-list">
              {(item.changes ?? []).map((change: AnyRecord) => (
                <code key={change.path}>{change.path}</code>
              ))}
            </div>
          </>
        )}
        {!isCommand && !isFile && (
          <>
            <h4>{t("工具")}</h4>
            <code className="detail-command">{item.tool || item.type}</code>
          </>
        )}
        <dl>
          <div><dt>{t("状态")}</dt><dd>{item.status === "inProgress" ? t("进行中") : item.status || t("已完成")}</dd></div>
          {item.cwd && <div><dt>{t("工作目录")}</dt><dd>{item.cwd}</dd></div>}
          {item.durationMs != null && <div><dt>{t("耗时")}</dt><dd>{item.durationMs} ms</dd></div>}
          {item.exitCode != null && <div><dt>{t("退出码")}</dt><dd>{item.exitCode}</dd></div>}
        </dl>
        {item.arguments != null && (
          <>
            <h4>{t("参数")}</h4>
            <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
          </>
        )}
        {output != null && (
          <>
            <h4>{isCommand ? t("输出") : t("详情")}</h4>
            <pre>{typeof output === "string" ? output : JSON.stringify(output, null, 2)}</pre>
          </>
        )}
    </ActionSheet>
  );
}

function diffHunkLabel(lines: ReturnType<typeof parseUnifiedDiff>, index: number) {
  const current = lines[index]?.text.match(
    /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/,
  );
  if (!current) return t("上下文");
  const start = Number(current[1]);
  let previousEnd = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor].type !== "hunk") continue;
    const previous = lines[cursor].text.match(
      /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/,
    );
    if (previous) {
      previousEnd = Number(previous[1]) + Number(previous[2] ?? 1);
    }
    break;
  }
  const unchanged = Math.max(0, start - previousEnd);
  return unchanged ? t("{count} 行未修改", { count: unchanged }) : t("上下文");
}

export function FileDiffSheet({
  item,
  onClose,
}: {
  item: AnyRecord;
  onClose: () => void;
}) {
  const changes = (item.changes ?? []) as AnyRecord[];
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(
    () => new Set(changes.length ? [0] : []),
  );
  return (
    <ActionSheet
      title={t("已更改 {count} 个文件", { count: changes.length })}
      ariaLabel={t("已更改 {count} 个文件", { count: changes.length })}
      onClose={onClose}
      closeLabel={t("关闭文件修改")}
      titleAlign="center"
      className="file-diff-sheet"
      backdropClassName="tool-detail-backdrop"
    >
        <div className="file-diff-list">
          {changes.map((change, changeIndex) => {
            const expanded = expandedFiles.has(changeIndex);
            const stats = summarizeFileChange(change);
            const lines = parseUnifiedDiff(change.diff ?? "");
            return (
              <section className="file-diff-entry" key={`${change.path}-${changeIndex}`}>
                <button
                  type="button"
                  className="file-diff-heading"
                  aria-expanded={expanded}
                  title={change.path}
                  onClick={() =>
                    setExpandedFiles((current) => {
                      const next = new Set(current);
                      if (next.has(changeIndex)) next.delete(changeIndex);
                      else next.add(changeIndex);
                      return next;
                    })
                  }
                >
                  <Chevron direction={expanded ? "down" : "right"} />
                  <strong>{change.path || t("未命名文件")}</strong>
                  {stats.additions > 0 && (
                    <span className="diff-add">+{stats.additions}</span>
                  )}
                  {stats.deletions > 0 && (
                    <span className="diff-delete">-{stats.deletions}</span>
                  )}
                </button>
                {expanded && (
                  <div className="file-diff-code">
                    {lines.length ? (
                      lines.map((line, lineIndex) =>
                        line.type === "hunk" ? (
                          <div
                            className="file-diff-hunk"
                            title={line.text}
                            key={`${lineIndex}-${line.text}`}
                          >
                            {diffHunkLabel(lines, lineIndex)}
                          </div>
                        ) : (
                          <div
                            className={`file-diff-line ${line.type}`}
                            key={`${lineIndex}-${line.oldLine}-${line.newLine}`}
                          >
                            <span>{line.oldLine ?? ""}</span>
                            <span>{line.newLine ?? ""}</span>
                            <code>{line.text || " "}</code>
                          </div>
                        ),
                      )
                    ) : (
                      <div className="file-diff-empty">{t("暂无 Diff 内容")}</div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
    </ActionSheet>
  );
}
