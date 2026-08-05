import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import { MockEmailProvider } from "./mock-email-provider";
import { SesEmailProvider, type SesCommandClient } from "./ses-email-provider";

const now = () => new Date("2026-08-05T00:00:00.000Z");

describe("SesEmailProvider", () => {
  it("sends a real SES template-shaped request", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(SendEmailCommand);
      const input = (command as SendEmailCommand).input;
      expect(input.FromEmailAddress).toBe("notifications@alter.ai");
      expect(input.Destination?.ToAddresses).toEqual(["user@example.com"]);
      expect(input.Content?.Template).toEqual({
        TemplateName: "notification-workflow-hi-IN",
        TemplateData: JSON.stringify({ title: "Run failed" }),
      });
      return { MessageId: "ses-message-1" };
    });
    const provider = new SesEmailProvider(
      {
        region: "ap-south-1",
        fromAddress: "notifications@alter.ai",
        credentialsSecretRef: "/alter/dev/notifications/system/ses-credentials",
      },
      vi.fn(),
      { send } as unknown as SesCommandClient,
      now,
    );

    await expect(
      provider.sendTemplatedEmail(
        "user@example.com",
        "notification-workflow",
        { title: "Run failed" },
        "hi-IN",
      ),
    ).resolves.toEqual({ messageId: "ses-message-1", acceptedAt: now().toISOString() });
  });

  it("requires a SES message ID", async () => {
    const provider = new SesEmailProvider(
      { region: "ap-south-1", fromAddress: "notifications@alter.ai", credentialsSecretRef: "ref" },
      vi.fn(),
      { send: vi.fn(async () => ({})) } as unknown as SesCommandClient,
    );
    await expect(provider.sendTemplatedEmail("user@example.com", "notification-system", {})).rejects.toThrow(
      "SES did not return a message ID",
    );
  });

  it("mock adapter records same contract input", async () => {
    const provider = new MockEmailProvider(now);
    await expect(provider.sendTemplatedEmail("user@example.com", "notification-system", { title: "Hello" })).resolves.toEqual({
      messageId: "mock-email-1",
      acceptedAt: now().toISOString(),
    });
    expect(provider.sent).toEqual([
      { to: "user@example.com", templateId: "notification-system", variables: { title: "Hello" }, locale: undefined },
    ]);
  });
});
