import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appUrl, renderAlertEmail, renderDigestEmail } from "@/lib/notifications/email";

const ORIGIN = "https://app.example.test";
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
});

afterAll(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

const XSS = '<script>alert("x")</script>';

/* ------------------------------------------------------------------ */
/* Link building                                                       */
/* ------------------------------------------------------------------ */

describe("appUrl", () => {
  it("prefixes a path with the configured origin and never doubles the slash", () => {
    expect(appUrl()).toBe(ORIGIN);
    expect(appUrl("/forecast")).toBe(`${ORIGIN}/forecast`);
  });
});

/* ------------------------------------------------------------------ */
/* Digest template                                                     */
/* ------------------------------------------------------------------ */

describe("renderDigestEmail", () => {
  const digest = () =>
    renderDigestEmail({
      title: "Your daily financial summary",
      periodLabel: "Covering the last 24 hours · 2026-07-27",
      bodyText: "You spent more than usual.\n\n- Rent: €1,200\n- Groceries: €80",
      stats: [
        { label: "Income", value: "€3,000.00" },
        { label: "Expenses", value: "€1,280.00" },
        { label: "Net", value: "€1,720.00" },
      ],
    });

  it("renders the title, the period and every stat", () => {
    const html = digest();
    expect(html).toContain("Your daily financial summary");
    expect(html).toContain("Covering the last 24 hours");
    for (const value of ["Income", "€3,000.00", "Expenses", "€1,280.00", "Net", "€1,720.00"]) {
      expect(html).toContain(value);
    }
  });

  it("lays the stats out two per row", () => {
    // Three stats: a full row, a spacer row, then a row holding the leftover.
    expect(digest().match(/<tr>/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      renderDigestEmail({
        title: "t",
        periodLabel: "p",
        bodyText: "b",
        stats: [
          { label: "a", value: "1" },
          { label: "b", value: "2" },
        ],
      })
    ).toContain('<td width="12" style="font-size:0;">&nbsp;</td>');
  });

  it("turns '- ' lines into a list and blank-line breaks into paragraphs", () => {
    const html = digest();
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("Rent: €1,200");
    expect(html).not.toContain("- Rent");
    expect(html).toContain("You spent more than usual.");
  });

  it("keeps single newlines inside a paragraph as line breaks", () => {
    const html = renderDigestEmail({
      title: "t",
      periodLabel: "p",
      bodyText: "First line\nSecond line",
      stats: [],
    });
    expect(html).toContain("First line<br />Second line");
  });

  it("links to the dashboard and to the settings page that explains the email", () => {
    const html = digest();
    expect(html).toContain(`href="${ORIGIN}/dashboard"`);
    expect(html).toContain(`href="${ORIGIN}/settings"`);
    expect(html).toContain("Ballast");
  });

  it("escapes every interpolated field, so a hostile value cannot inject markup", () => {
    const html = renderDigestEmail({
      title: XSS,
      periodLabel: XSS,
      bodyText: `${XSS}\n\n- ${XSS}`,
      stats: [{ label: XSS, value: XSS }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

/* ------------------------------------------------------------------ */
/* Alert template                                                      */
/* ------------------------------------------------------------------ */

describe("renderAlertEmail", () => {
  it("renders the message, the detail rows and the deep-linked CTA", () => {
    const html = renderAlertEmail({
      title: "Low cash warning",
      bodyText: "Your balance is below your floor.",
      details: [
        { label: "Current balance", value: "€120.00" },
        { label: "Configured floor", value: "€500.00" },
      ],
      ctaLabel: "Open forecast",
      ctaPath: "/forecast",
    });

    expect(html).toContain("Low cash warning");
    expect(html).toContain("Your balance is below your floor.");
    expect(html).toContain("Current balance");
    expect(html).toContain("€120.00");
    expect(html).toContain("Configured floor");
    expect(html).toContain(`href="${ORIGIN}/forecast"`);
    expect(html).toContain("Open forecast");
  });

  it("omits the detail table entirely when there are no rows", () => {
    const html = renderAlertEmail({
      title: "Invoice reminder",
      bodyText: "You have 2 invoices due.",
      ctaLabel: "Open invoices",
      ctaPath: "/invoices",
    });
    expect(html).not.toContain("border-bottom:1px solid #f1f5f9");
    expect(html).toContain(`href="${ORIGIN}/invoices"`);
  });

  it("escapes hostile detail rows, the title and the CTA label", () => {
    const html = renderAlertEmail({
      title: XSS,
      bodyText: XSS,
      details: [{ label: XSS, value: XSS }],
      ctaLabel: XSS,
      ctaPath: "/transactions",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("produces a complete standalone HTML document", () => {
    const html = renderAlertEmail({
      title: "t",
      bodyText: "b",
      ctaLabel: "c",
      ctaPath: "/dashboard",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });
});
