import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";

/**
 * Publish a non-secret test marker without invoking the production secret-path hardening.
 * Exclusive creation and descriptor/entry identity checks prevent a predictable temporary
 * path from becoming a symlink-following write, while rename keeps the reader view atomic.
 */
export function publishFixtureFile(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    const opened = fstatSync(descriptor);
    const linked = lstatSync(temporaryPath);
    if (!opened.isFile() || !linked.isFile()
      || opened.dev !== linked.dev || opened.ino !== linked.ino) {
      throw new Error("fixture temporary file identity changed before write");
    }
    writeFileSync(descriptor, content, "utf8");
    const written = fstatSync(descriptor);
    const published = lstatSync(temporaryPath);
    if (!published.isFile() || written.dev !== published.dev || written.ino !== published.ino) {
      throw new Error("fixture temporary file identity changed after write");
    }
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
}
