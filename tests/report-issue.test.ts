import { describe, expect, it } from "vitest";

import { buildReportIssueBody } from "@/lib/report-issue";

describe("buildReportIssueBody", () => {
  it("includes user notes and error context", () => {
    const body = buildReportIssueBody({
      pageUrl: "http://localhost:3000/import",
      userAgent: "TestBrowser/1.0",
      errorMessage: "Import failed",
      errorDigest: "abc123",
      userNotes: "CSV upload hung at 90%",
    });

    expect(body).toContain("CSV upload hung at 90%");
    expect(body).toContain("http://localhost:3000/import");
    expect(body).toContain("TestBrowser/1.0");
    expect(body).toContain("Import failed");
    expect(body).toContain("abc123");
    expect(body).toContain("Steps to reproduce");
  });

  it("uses placeholders when notes are missing", () => {
    const body = buildReportIssueBody({ pageUrl: "http://localhost:3000/dashboard" });

    expect(body).toContain("_Describe what you were doing");
    expect(body).toContain("http://localhost:3000/dashboard");
  });
});
