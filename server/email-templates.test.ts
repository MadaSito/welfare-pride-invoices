import { describe, expect, it } from "vitest";
import { renderInvoiceEmailTemplate, validateEmailTemplate } from "./services/emailTemplates";

const context = { invoiceNumber: "WP-2026-1001", companyName: "Welfare Pride", clientName: "Alex <Client>", invoiceTotal: "$1,250.00", currency: "USD", issueDate: "October 30, 2026", dueDate: "November 30, 2026", paymentInstructions: "ACH transfer" };

describe("invoice email templates", () => {
  it("rejects unsupported placeholders and strips unsafe HTML", () => {
    expect(() => validateEmailTemplate({ subjectTemplate: "Invoice {{password}}", htmlBodyTemplate: "<p>Hi</p>" })).toThrow(/unsupported placeholder/);
    const template = validateEmailTemplate({ subjectTemplate: "Invoice {{invoiceNumber}}\r\nBCC: attacker@example.com", htmlBodyTemplate: "<script>alert(1)</script><p>Hello {{clientName}}</p>" });
    expect(template.subjectTemplate).not.toContain("\n");
    expect(template.htmlBodyTemplate).not.toContain("script");
  });

  it("escapes resolved values rather than injecting client text into HTML", () => {
    const output = renderInvoiceEmailTemplate({ subjectTemplate: "Invoice {{invoiceNumber}}", htmlBodyTemplate: "<p>Hello {{clientName}}</p>" }, context);
    expect(output.subject).toBe("Invoice WP-2026-1001");
    expect(output.html).toContain("Alex &lt;Client&gt;");
  });
});
