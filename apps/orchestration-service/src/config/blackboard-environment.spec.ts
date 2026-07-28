import { describe, expect, it } from "vitest";

import {
  BlackboardConfigurationError,
  loadBlackboardEnvironment,
  parseRedisHostPort,
} from "./blackboard-environment";

describe("parseRedisHostPort", () => {
  it("parses host and port from a redis:// URL", () => {
    expect(parseRedisHostPort("redis://my-redis-host:6380")).toEqual({
      host: "my-redis-host",
      port: 6380,
    });
  });

  it("defaults to port 6379 when the URL omits one", () => {
    expect(parseRedisHostPort("redis://my-redis-host")).toEqual({
      host: "my-redis-host",
      port: 6379,
    });
  });

  it("throws BlackboardConfigurationError on an invalid URL", () => {
    expect(() => parseRedisHostPort("not a url")).toThrow(
      BlackboardConfigurationError,
    );
  });
});

describe("loadBlackboardEnvironment", () => {
  it("defaults grpcBindAddress when unset", () => {
    expect(loadBlackboardEnvironment({}).grpcBindAddress).toBe("0.0.0.0:50057");
  });

  it("rejects a malformed grpc bind address", () => {
    expect(() =>
      loadBlackboardEnvironment({ BLACKBOARD_GRPC_BIND_ADDRESS: "not-an-address" }),
    ).toThrow(BlackboardConfigurationError);
  });
});
