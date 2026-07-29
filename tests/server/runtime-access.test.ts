import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeRuntimeAccess } from "../../server/runtime-access.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI 运行信息", () => {
  it("以仅当前用户可读写的权限保存实际端口和口令", async () => {
    const directory = mkdtempSync(`${tmpdir()}/codex-mobile-runtime-`);
    directories.push(directory);
    const file = resolve(directory, "nested", "runtime.json");

    await writeRuntimeAccess(file, {
      port: 19000,
      token: "secret",
    });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      port: 19000,
      token: "secret",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
