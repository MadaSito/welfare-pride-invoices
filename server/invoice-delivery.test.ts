import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allocateInvoiceNumberForSending: vi.fn(),
  completeEmailLog: vi.fn(),
  getEmailProviderConfig: vi.fn(),
  getInvoiceBundle: vi.fn(),
  setInvoiceStatus: vi.fn(),
  startInvoiceDeliveryLog: vi.fn(),
  decryptConfig: vi.fn(),
  sendProviderEmail: vi.fn(),
  renderInvoicePdf: vi.fn(),
}));

vi.mock("./db", () => ({
  allocateInvoiceNumberForSending: mocks.allocateInvoiceNumberForSending,
  completeEmailLog: mocks.completeEmailLog,
  getEmailProviderConfig: mocks.getEmailProviderConfig,
  getInvoiceBundle: mocks.getInvoiceBundle,
  setInvoiceStatus: mocks.setInvoiceStatus,
  startInvoiceDeliveryLog: mocks.startInvoiceDeliveryLog,
}));
vi.mock("./security/crypto", () => ({ decryptConfig: mocks.decryptConfig }));
vi.mock("./services/mailer", () => ({
  escapeHtml: (value: string) => value,
  sendProviderEmail: mocks.sendProviderEmail,
}));
vi.mock("./services/pdf", () => ({
  invoicePdfFilename: (value: string) => `${value}.pdf`,
  renderInvoicePdf: mocks.renderInvoicePdf,
}));

import { deliverFinalizedInvoice, InvoiceDeliveryError } from "./services/invoiceDelivery";

const bundle = {
  invoice: { id: 41, status: "finalized", invoiceNumber: "WP-2026-1001", currency: "USD", totalCents: 12_500 },
  company: { name: "Welfare Pride", defaultBcc: null },
  contact: { email: "client@example.org", contactName: "Alex", companyName: "Client Org" },
  lineItems: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getInvoiceBundle.mockResolvedValue(bundle);
  mocks.getEmailProviderConfig.mockResolvedValue({ isActive: true, provider: "smtp", encryptedConfig: "encrypted" });
  mocks.decryptConfig.mockReturnValue({ provider: "smtp", host: "smtp.example.org" });
  mocks.allocateInvoiceNumberForSending.mockResolvedValue(bundle);
  mocks.startInvoiceDeliveryLog.mockResolvedValue(9);
  mocks.renderInvoicePdf.mockResolvedValue(Buffer.from("pdf"));
  mocks.completeEmailLog.mockResolvedValue(undefined);
  mocks.setInvoiceStatus.mockResolvedValue(bundle);
});

describe("invoice delivery safety", () => {
  it("returns a known pre-dispatch failure to finalized and marks the outbox attempt failed", async () => {
    mocks.renderInvoicePdf.mockRejectedValueOnce(new Error("PDF render unavailable"));

    await expect(deliverFinalizedInvoice({ companyId: 7, invoiceId: 41, correlationId: "test-correlation" })).rejects.toBeInstanceOf(InvoiceDeliveryError);

    expect(mocks.sendProviderEmail).not.toHaveBeenCalled();
    expect(mocks.completeEmailLog).toHaveBeenCalledWith(9, "failed", "PDF render unavailable");
    expect(mocks.setInvoiceStatus).toHaveBeenNthCalledWith(1, 7, 41, "sending", "finalized");
    expect(mocks.setInvoiceStatus).toHaveBeenLastCalledWith(7, 41, "finalized", "sending");
  });

  it("keeps the invoice sending and records uncertain when the provider call may have accepted the email", async () => {
    mocks.sendProviderEmail.mockRejectedValueOnce(new Error("socket timeout"));

    try {
      await deliverFinalizedInvoice({ companyId: 7, invoiceId: 41, correlationId: "test-correlation" });
      throw new Error("Expected delivery to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(InvoiceDeliveryError);
      expect((error as InvoiceDeliveryError).outcome).toBe("uncertain");
    }

    expect(mocks.completeEmailLog).toHaveBeenCalledWith(9, "uncertain", "Provider dispatch started; awaiting a confirmed acceptance response.");
    expect(mocks.completeEmailLog).toHaveBeenLastCalledWith(9, "uncertain", "Provider outcome is uncertain after dispatch began. An administrator must reconcile this attempt before retrying.");
    expect(mocks.setInvoiceStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setInvoiceStatus).toHaveBeenCalledWith(7, 41, "sending", "finalized");
  });
});
