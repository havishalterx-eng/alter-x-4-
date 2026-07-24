import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import type { RedisSetClient } from "./redis-replay-store";

export class RedisRespSetClient implements RedisSetClient {
  readonly #url: URL;

  constructor(connectionUrl: string) {
    this.#url = new URL(connectionUrl);
    if (!["redis:", "rediss:"].includes(this.#url.protocol)) {
      throw new Error("Redis connection must use redis:// or rediss://");
    }
    if (this.#url.username || this.#url.password) {
      throw new Error(
        "Redis credentials must be resolved by an approved adapter, not embedded in the endpoint",
      );
    }
  }

  async set(
    key: string,
    value: string,
    options: { readonly nx: true; readonly ex: number },
  ): Promise<"OK" | null> {
    const commands: string[][] = [];
    commands.push([
      "SET",
      key,
      value,
      "NX",
      "EX",
      String(options.ex),
    ]);
    const replies = await this.#execute(commands);
    const result = replies.at(-1);
    if (result === "$-1") {
      return null;
    }
    if (result !== "+OK") {
      throw new Error("Redis replay write failed");
    }
    return "OK";
  }

  #execute(commands: readonly string[][]): Promise<string[]> {
    const port = Number(this.#url.port || 6379);
    const host = this.#url.hostname;
    const payload = commands.map(encodeCommand).join("");

    return new Promise((resolve, reject) => {
      const socket =
        this.#url.protocol === "rediss:"
          ? connectTls({ host, port, servername: host })
          : connectTcp({ host, port });
      let buffer = "";
      socket.setTimeout(5_000);
      socket.on("connect", () => socket.write(payload));
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const replies = parseReplies(buffer);
        if (replies.length === commands.length) {
          socket.end();
          resolve(replies);
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("Redis replay write timed out"));
      });
      socket.on("error", () => reject(new Error("Redis replay write failed")));
    });
  }
}

function encodeCommand(parts: readonly string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`;
}

function parseReplies(buffer: string): string[] {
  return buffer
    .split("\r\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-") || line === "$-1");
}
