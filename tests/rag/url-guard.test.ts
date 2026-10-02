import { describe, expect, it } from "bun:test";
import { UnsafeUrlError, assertFetchableUrl } from "../../lib/rag/url-guard";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("assertFetchableUrl", () => {
  it("allows an ordinary public https url", async () => {
    await expect(assertFetchableUrl("https://example.com/handbook", { lookup: publicLookup })).resolves
      .toBeDefined();
  });

  it("rejects a non-http scheme", async () => {
    await expect(assertFetchableUrl("file:///etc/passwd", { lookup: publicLookup })).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(assertFetchableUrl("gopher://example.com", { lookup: publicLookup })).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects loopback addresses given literally", async () => {
    for (const url of ["http://127.0.0.1/", "http://localhost:5432/", "http://[::1]/"]) {
      await expect(assertFetchableUrl(url, { lookup: publicLookup })).rejects.toThrow(UnsafeUrlError);
    }
  });

  it("rejects the cloud metadata address", async () => {
    await expect(
      assertFetchableUrl("http://169.254.169.254/latest/meta-data/", { lookup: publicLookup }),
    ).rejects.toThrow(/private|internal|not allowed/i);
  });

  it("rejects private ranges given literally", async () => {
    for (const url of ["http://10.0.0.5/", "http://172.16.4.1/", "http://192.168.1.1/", "http://[fd00::1]/"]) {
      await expect(assertFetchableUrl(url, { lookup: publicLookup })).rejects.toThrow(UnsafeUrlError);
    }
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    const rebinding = async () => [{ address: "169.254.169.254", family: 4 }];

    await expect(assertFetchableUrl("https://evil.example.com/", { lookup: rebinding })).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects a hostname that resolves to any private address, even alongside public ones", async () => {
    const mixed = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];

    await expect(assertFetchableUrl("https://mixed.example.com/", { lookup: mixed })).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects a hostname that cannot be resolved", async () => {
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };

    await expect(assertFetchableUrl("https://nope.example.com/", { lookup: failing })).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects internal-looking hostnames outright", async () => {
    await expect(assertFetchableUrl("http://db.internal/", { lookup: publicLookup })).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("returns the parsed url so the caller fetches exactly what was checked", async () => {
    const url = await assertFetchableUrl("https://example.com/a?b=1", { lookup: publicLookup });

    expect(url.href).toBe("https://example.com/a?b=1");
  });
});
