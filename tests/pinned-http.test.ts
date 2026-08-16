import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, test } from "bun:test";
import { pinnedHttpGet } from "../src/lib/pinned-http";

let server: Server | undefined;
const sockets = new Set<Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) {
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
});

describe("pinned HTTP timeouts", () => {
  test("legacy idle timeout remains an absolute response-header deadline", async () => {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write("HTTP/1.1 200 OK\r\nX-Slow: ");
      const drip = setInterval(() => socket.write("x"), 10);
      socket.on("close", () => clearInterval(drip));
    });
    const port = await new Promise<number>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        const address = server!.address();
        if (!address || typeof address === "string") {
          reject(new Error("test server did not expose a TCP port"));
          return;
        }
        resolve(address.port);
      });
    });

    const request = pinnedHttpGet(
      `http://slow-header.invalid:${port}/`,
      { address: "127.0.0.1", family: 4 },
      undefined,
      { idleTimeoutMs: 50 },
    );

    await expect(request).rejects.toThrow(/timed out/);
  });
});
