import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/build-android.yml', 'utf8'));
const versionScript = workflow.jobs.version.steps.find((step: { name: string }) => step.name === 'Resolve app version').run;

function resolveVersion({latest = 'v0.2.26', versions = '["0.2.26","0.2.27"]', fallback = '0.2.0', requested = '0.2.28', registryFails = false, githubFails = false, event = "workflow_dispatch"} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mobile-release-recovery-'));
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'codex-mobile', version: fallback }));
    writeFileSync(join(directory, 'gh'), '#!/bin/sh\n[ "$1" = api ] || exit 2\n[ "$FIXTURE_GITHUB_FAILS" = false ] || exit 1\nprintf "%s\\n" "$FIXTURE_LATEST"\n');
    writeFileSync(join(directory, 'npm'), '#!/bin/sh\n[ "$*" = "view codex-mobile versions --json --registry=https://registry.npmjs.org" ] || exit 2\n[ "$FIXTURE_REGISTRY_FAILS" = false ] || exit 1\nprintf "%s\\n" "$FIXTURE_VERSIONS"\n');
    chmodSync(join(directory, 'gh'), 0o755);
    chmodSync(join(directory, 'npm'), 0o755);
    let script = versionScript;
    let sha = "";
    if (event === "push") {
      spawnSync("git", ["init", "--quiet"], { cwd: directory });
      spawnSync("git", ["add", "package.json"], { cwd: directory });
      spawnSync("git", ["-c", "user.name=CI Test", "-c", "user.email=ci@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: directory });
      sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).stdout.trim();
      script = script.replace("${{ github.event.before }}", sha);
    }
    const output = join(directory, 'output');
    const result = spawnSync('bash', ['-c', script], {
      cwd: directory, encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_EVENT_NAME: event, GITHUB_SHA: sha, PUBLISH_NPM_REQUESTED: 'true', REQUESTED_VERSION: requested, GITHUB_REPOSITORY: 'loock-ai/codex-mobile', GITHUB_RUN_NUMBER: '39', ENABLE_IOS_BUILD: 'false', GITHUB_ENV: join(directory, 'env'), GITHUB_OUTPUT: output, FIXTURE_LATEST: latest, FIXTURE_VERSIONS: versions, FIXTURE_REGISTRY_FAILS: String(registryFails), FIXTURE_GITHUB_FAILS: String(githubFails) },
    });
    return { ...result, output: result.status === 0 ? readFileSync(output, 'utf8') : '' };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('发布恢复回归', () => {
  it('npm 领先 GitHub Release 时选择未发布的下一个版本', () => {
    const result = resolveVersion();
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain('app_version=0.2.28');
  });
  it('仓库版本领先时保留版本下限，并按数字比较版本', () => {
    const result = resolveVersion({ latest: 'v0.2.9', versions: '["0.2.10","0.3.0-beta.1"]', fallback: '0.2.12', requested: '0.2.13' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain('app_version=0.2.13');
  });
  it('拒绝手动发布 npm 上已经存在的版本', () => {
    expect(resolveVersion({ requested: '0.2.27' }).status).not.toBe(0);
  });
  it('npm 查询失败时停止，避免选择已存在的版本', () => {
    const result = resolveVersion({ registryFails: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to resolve published npm versions");
  });
  it('版本数据损坏时停止发布', () => {
    const result = resolveVersion({ versions: 'not-json' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SyntaxError");
  });
  it('GitHub 查询失败时停止发布', () => {
    const result = resolveVersion({ githubFails: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to resolve the latest GitHub Release");
  });
  it('push 自动构建同样避开 npm 已发布版本', () => {
    const result = resolveVersion({ event: "push", requested: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain("app_version=0.2.28");
  });
  it('push 查询失败时立即停止', () => {
    const result = resolveVersion({ event: "push", registryFails: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to resolve published npm versions");
  });
  it('SDK 初始化不会请求已经不可用的旧 tools 包', () => {
    const sdk = workflow.jobs.build.steps.find((step: { name: string }) => step.name === 'Set up Android SDK');
    // setup-android v3 默认请求 tools；我们的边界必须显式覆盖安装列表。
    const packages = String(sdk.with?.packages ?? 'tools platform-tools').split(/\s+/);
    expect(packages).not.toContain('tools');
    expect(packages).toContain('platform-tools');
  });
});
