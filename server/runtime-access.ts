import {
  chmod,
  mkdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export async function writeRuntimeAccess(
  file: string | undefined,
  value: {
    port: number;
    token: string;
  },
) {
  if (!file) return;
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporaryFile, 0o600);
  await rename(temporaryFile, file);
}
