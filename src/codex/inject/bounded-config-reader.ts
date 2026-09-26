import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

const MAX_CODEX_CONFIG_BYTES = 1024 * 1024;

/** Read config.toml without following links, blocking on special files, or buffering without bound. */
export function readBoundedCodexConfig(path: string): string | null {
  let fd: number | undefined;
  try {
    const namedBefore = lstatSync(path);
    if (namedBefore.isSymbolicLink() || !namedBefore.isFile()
      || namedBefore.size > MAX_CODEX_CONFIG_BYTES) {
      throw new Error("config.toml is not a bounded regular file");
    }
    const guardedFlags = process.platform === "win32"
      ? 0
      : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    fd = openSync(path, constants.O_RDONLY | guardedFlags);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_CODEX_CONFIG_BYTES) {
      throw new Error("config.toml is not a bounded regular file");
    }

    const buffer = Buffer.allocUnsafe(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    const after = fstatSync(fd);
    const namedAfter = lstatSync(path);
    if (bytesRead !== before.size || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || namedAfter.isSymbolicLink() || !namedAfter.isFile()
      || namedAfter.dev !== before.dev || namedAfter.ino !== before.ino) {
      throw new Error("config.toml changed while it was read");
    }
    return buffer.toString("utf8", 0, bytesRead);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
