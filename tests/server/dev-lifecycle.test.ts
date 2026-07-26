import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const concurrentlyBin = resolve("node_modules/.bin/concurrently");

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nodeCommand(source: string): string {
  return `${shellQuote(process.execPath)} -e ${shellQuote(source)}`;
}

function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs = 4_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("concurrently 没有在预期时间内退出"));
    }, timeoutMs);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitForPid(path: string): Promise<number> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      return Number.parseInt(await readFile(path, "utf8"), 10);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw new Error(`子进程没有写入 PID：${path}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnConcurrent(commands: string[]) {
  return spawn(
    concurrentlyBin,
    ["--kill-others", "--success", "first", ...commands],
    { stdio: "ignore" },
  );
}

describe("开发双进程生命周期", () => {
  it.each([
    ["正常退出", 0, 0],
    ["异常退出", 7, 1],
  ])("%s时会关闭另一个子进程", async (_name, childExit, parentExit) => {
    const directory = await mkdtemp(join(tmpdir(), "codex-mobile-dev-"));
    const survivorPidPath = join(directory, "survivor.pid");
    const survivor = nodeCommand(
      `require("node:fs").writeFileSync(${JSON.stringify(survivorPidPath)}, String(process.pid)); setInterval(() => {}, 1000)`,
    );
    const terminator = nodeCommand(
      `setTimeout(() => process.exit(${childExit}), 80)`,
    );

    let survivorPid: number | undefined;

    try {
      const child = spawnConcurrent([survivor, terminator]);
      survivorPid = await waitForPid(survivorPidPath);
      const result = await waitForExit(child);

      expect(result.code).toBe(parentExit);
      expect(isRunning(survivorPid)).toBe(false);
    } finally {
      if (survivorPid && isRunning(survivorPid)) {
        process.kill(survivorPid, "SIGKILL");
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("收到 SIGTERM 时会关闭全部子进程", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-mobile-dev-"));
    const firstPidPath = join(directory, "first.pid");
    const secondPidPath = join(directory, "second.pid");
    const persistentCommand = (path: string) =>
      nodeCommand(
        `require("node:fs").writeFileSync(${JSON.stringify(path)}, String(process.pid)); setInterval(() => {}, 1000)`,
      );

    let childPids: number[] = [];

    try {
      const child = spawnConcurrent([
        persistentCommand(firstPidPath),
        persistentCommand(secondPidPath),
      ]);
      childPids = await Promise.all([
        waitForPid(firstPidPath),
        waitForPid(secondPidPath),
      ]);

      expect(child.kill("SIGTERM")).toBe(true);
      await waitForExit(child);

      expect(childPids.every((pid) => !isRunning(pid))).toBe(true);
    } finally {
      for (const pid of childPids) {
        if (isRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
