import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  I18nProvider,
  detectLocale,
  hasEnglishTranslation,
  t,
  useI18n,
} from "../../src/i18n";
import { BackendManagerSheet } from "../../src/features/backends/BackendManagerSheet";
import { createDefaultBackendRegistry } from "../../src/backends/registry";

function LanguageProbe() {
  const { locale, preference, setPreference } = useI18n();
  return (
    <div>
      <span>{locale}</span>
      <span>{preference}</span>
      <button onClick={() => setPreference("en")}>{t("切换语言")}</button>
    </div>
  );
}

describe("多语言基础设施", () => {
  it("跟随系统识别中英文语言", () => {
    expect(detectLocale("zh-CN")).toBe("zh-CN");
    expect(detectLocale("en-US")).toBe("en");
  });

  it("用户选择语言后持久化并立即更新界面", () => {
    localStorage.clear();
    const { container } = render(
      <I18nProvider navigatorLanguage="zh-CN">
        <LanguageProbe />
      </I18nProvider>,
    );
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: "切换语言" }));

    expect(view.getAllByText("en")).toHaveLength(2);
    expect(localStorage.getItem("codex-mobile:language")).toBe("en");
    expect(view.getByRole("button", { name: "Switch language" })).not.toBeNull();
  });

  it("设备设置可以切换为英文并立即更新全部设置文案", () => {
    localStorage.clear();
    render(
      <I18nProvider navigatorLanguage="zh-CN">
        <BackendManagerSheet
          open
          registry={createDefaultBackendRegistry("http://127.0.0.1:4173")}
          summaries={{}}
          onChange={() => undefined}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "英文" }));

    expect(screen.getByText("Language")).not.toBeNull();
    expect(screen.getByRole("button", { name: "English" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add device" })).not.toBeNull();
    expect(localStorage.getItem("codex-mobile:language")).toBe("en");
  });

  it("源码中直接使用的多语言键都有英文翻译", () => {
    const sourceRoot = join(process.cwd(), "src");
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.(?:ts|tsx)$/.test(entry.name) && entry.name !== "i18n.tsx") files.push(path);
      }
    };
    visit(sourceRoot);
    const missing = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/["']([^"'\n]*\p{Script=Han}[^"'\n]*)["']/gu)) {
        if (!hasEnglishTranslation(match[1])) {
          missing.add(match[1]);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
