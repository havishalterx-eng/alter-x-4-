import { describe, expect, it } from "vitest";

import {
  SsrfBlockedError,
  assertHostnameNotLiteralBlockedIp,
  assertResolvedAddressesNotBlocked,
  assertUrlSchemeAllowed,
  isBlockedIpLiteral,
} from "./ssrf-guard";

describe("ssrf-guard", () => {
  describe("isBlockedIpLiteral", () => {
    it.each([
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "240.0.0.1",
    ])("blocks IPv4 %s", (ip) => {
      expect(isBlockedIpLiteral(ip, 4)).toBe(true);
    });

    it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1"])(
      "allows public IPv4 %s",
      (ip) => {
        expect(isBlockedIpLiteral(ip, 4)).toBe(false);
      },
    );

    it.each(["::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1"])(
      "blocks IPv6 %s",
      (ip) => {
        expect(isBlockedIpLiteral(ip, 6)).toBe(true);
      },
    );

    it("blocks an IPv4-mapped IPv6 loopback (dotted-decimal form)", () => {
      expect(isBlockedIpLiteral("::ffff:127.0.0.1", 6)).toBe(true);
    });

    it("blocks an IPv4-mapped IPv6 loopback in the hex-group form the URL parser normalizes to", () => {
      // `new URL("https://[::ffff:127.0.0.1]/").hostname` actually returns
      // "[::ffff:7f00:1]" (hex groups), not the dotted-decimal form above.
      // Missing this form is a real SSRF bypass.
      expect(isBlockedIpLiteral("::ffff:7f00:1", 6)).toBe(true);
    });

    it("blocks an IPv4-mapped IPv6 AWS metadata address in hex-group form", () => {
      // 169.254.169.254 -> a9fe:a9fe
      expect(isBlockedIpLiteral("::ffff:a9fe:a9fe", 6)).toBe(true);
    });

    it("allows a public IPv4-mapped IPv6 address in hex-group form", () => {
      // 93.184.216.34 -> 5db8:d822
      expect(isBlockedIpLiteral("::ffff:5db8:d822", 6)).toBe(false);
    });

    it("allows a public IPv6 address", () => {
      expect(isBlockedIpLiteral("2606:4700:4700::1111", 6)).toBe(false);
    });
  });

  describe("assertUrlSchemeAllowed", () => {
    it("allows https by default", () => {
      expect(() =>
        assertUrlSchemeAllowed(new URL("https://example.com")),
      ).not.toThrow();
    });

    it("rejects http by default", () => {
      expect(() =>
        assertUrlSchemeAllowed(new URL("http://example.com")),
      ).toThrow(SsrfBlockedError);
    });

    it("respects a custom allowed-scheme policy", () => {
      expect(() =>
        assertUrlSchemeAllowed(new URL("http://example.com"), {
          allowedSchemes: ["http:", "https:"],
        }),
      ).not.toThrow();
    });
  });

  describe("assertHostnameNotLiteralBlockedIp", () => {
    it("rejects a literal private IPv4 host", () => {
      expect(() => assertHostnameNotLiteralBlockedIp("10.0.0.5")).toThrow(
        SsrfBlockedError,
      );
    });

    it("allows a normal hostname (resolved later via DNS)", () => {
      expect(() =>
        assertHostnameNotLiteralBlockedIp("example.com"),
      ).not.toThrow();
    });

    it("rejects a bracketed literal IPv6 loopback host", () => {
      expect(() => assertHostnameNotLiteralBlockedIp("[::1]")).toThrow(
        SsrfBlockedError,
      );
    });
  });

  describe("assertResolvedAddressesNotBlocked", () => {
    it("rejects when any resolved address is blocked (DNS rebinding defense)", () => {
      expect(() =>
        assertResolvedAddressesNotBlocked([
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ]),
      ).toThrow(SsrfBlockedError);
    });

    it("allows when every resolved address is public", () => {
      expect(() =>
        assertResolvedAddressesNotBlocked([
          { address: "93.184.216.34", family: 4 },
          { address: "2606:4700:4700::1111", family: 6 },
        ]),
      ).not.toThrow();
    });
  });
});
