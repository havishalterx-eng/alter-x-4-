import { describe, expect, it, vi } from "vitest";

import {
  UnknownPlatformJobTypeError,
  createPlatformJobActivities,
  type PlatformJobHandler,
} from "./platform-job-activities";

describe("createPlatformJobActivities", () => {
  it("dispatches to the registered handler for the job type and returns its result", async () => {
    const handler: PlatformJobHandler = vi.fn(async (payload) => ({
      echoed: payload,
    }));
    const activities = createPlatformJobActivities(
      new Map([["platform.health-ping", handler]]),
    );

    const result = await activities.executePlatformJob({
      jobType: "platform.health-ping",
      payloadJson: JSON.stringify({ hello: "world" }),
    });

    expect(handler).toHaveBeenCalledWith({ hello: "world" });
    expect(JSON.parse(result.resultJson)).toEqual({
      echoed: { hello: "world" },
    });
  });

  it("throws UnknownPlatformJobTypeError for an unregistered job type", async () => {
    const activities = createPlatformJobActivities(new Map());

    await expect(
      activities.executePlatformJob({
        jobType: "does.not.exist",
        payloadJson: "{}",
      }),
    ).rejects.toThrow(UnknownPlatformJobTypeError);
  });

  it("never routes one job type's payload to a different job type's handler", async () => {
    const pingHandler: PlatformJobHandler = vi.fn(async () => ({ pong: true }));
    const exportHandler: PlatformJobHandler = vi.fn(async () => ({
      exported: true,
    }));
    const activities = createPlatformJobActivities(
      new Map([
        ["platform.health-ping", pingHandler],
        ["platform.export", exportHandler],
      ]),
    );

    await activities.executePlatformJob({
      jobType: "platform.export",
      payloadJson: "{}",
    });

    expect(exportHandler).toHaveBeenCalledTimes(1);
    expect(pingHandler).not.toHaveBeenCalled();
  });
});
