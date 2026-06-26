import { describe, expect, it } from "vitest";
import { isPostHogProxyHost, postHogTargetUrl } from "./posthog-proxy";

describe("isPostHogProxyHost", () => {
  it("matches only the analytics subdomain", () => {
    expect(isPostHogProxyHost("e.news.justwallage.nl")).toBe(true);
    expect(isPostHogProxyHost("news.justwallage.nl")).toBe(false);
    expect(isPostHogProxyHost("localhost")).toBe(false);
  });
});

describe("postHogTargetUrl", () => {
  it("routes event ingestion to the EU API host, preserving path + query", () => {
    const target = postHogTargetUrl(
      new URL("https://e.news.justwallage.nl/i/v0/e/?ip=1"),
    );
    expect(target.hostname).toBe("eu.i.posthog.com");
    expect(target.protocol).toBe("https:");
    expect(target.pathname).toBe("/i/v0/e/");
    expect(target.search).toBe("?ip=1");
  });

  it("routes /static/* and /array/* to the EU assets host", () => {
    expect(
      postHogTargetUrl(new URL("https://e.news.justwallage.nl/static/array.js"))
        .hostname,
    ).toBe("eu-assets.i.posthog.com");
    expect(
      postHogTargetUrl(
        new URL("https://e.news.justwallage.nl/array/KEY/config.js"),
      ).hostname,
    ).toBe("eu-assets.i.posthog.com");
  });
});
