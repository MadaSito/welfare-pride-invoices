import nodemailer from "nodemailer";

export type GraphProviderConfig = {
  provider: "microsoft_graph";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
  displayName: string;
};

export type SmtpProviderConfig = {
  provider: "smtp";
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  displayName: string;
};

export type ProviderConfig = GraphProviderConfig | SmtpProviderConfig;
export type OutboundMessage = {
  to: string;
  bcc?: string | null;
  subject: string;
  html: string;
  attachment?: { filename: string; content: Buffer };
};

function safeName(value: string) {
  return value.replace(/[\r\n<>]/g, "").trim().slice(0, 160);
}

function graphRecipients(addresses: string[]) {
  return addresses.filter(Boolean).map(address => ({ emailAddress: { address } }));
}

async function graphAccessToken(config: GraphProviderConfig) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !payload.access_token) throw new Error(`Microsoft Graph authentication failed: ${payload.error_description || payload.error || response.statusText}`);
  return payload.access_token;
}

async function sendWithGraph(config: GraphProviderConfig, message: OutboundMessage) {
  const token = await graphAccessToken(config);
  const graphMessage: Record<string, unknown> = {
    subject: message.subject,
    body: { contentType: "HTML", content: message.html },
    toRecipients: graphRecipients([message.to]),
    // Exchange enforces the mailbox identity for application sends; this name is supplied for providers that allow it.
    from: { emailAddress: { address: config.senderEmail, name: safeName(config.displayName) } },
  };
  if (message.bcc) graphMessage.bccRecipients = graphRecipients([message.bcc]);
  if (message.attachment) {
    graphMessage.attachments = [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: message.attachment.filename,
      contentType: "application/pdf",
      contentBytes: message.attachment.content.toString("base64"),
    }];
  }
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: graphMessage, saveToSentItems: true }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Microsoft Graph send failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return { provider: "microsoft_graph" as const, messageId: response.headers.get("request-id") || "accepted" };
}

async function sendWithSmtp(config: SmtpProviderConfig, message: OutboundMessage) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  });
  const info = await transporter.sendMail({
    from: `"${safeName(config.displayName)}" <${config.fromEmail}>`,
    to: message.to,
    bcc: message.bcc || undefined,
    subject: message.subject,
    html: message.html,
    attachments: message.attachment ? [{ filename: message.attachment.filename, content: message.attachment.content, contentType: "application/pdf" }] : undefined,
  });
  return { provider: "smtp" as const, messageId: info.messageId || "accepted" };
}

export async function sendProviderEmail(config: ProviderConfig, message: OutboundMessage) {
  if (config.provider === "microsoft_graph") return sendWithGraph(config, message);
  return sendWithSmtp(config, message);
}

export async function testProviderConnection(config: ProviderConfig, recipient: string) {
  const displayName = safeName(config.displayName);
  return sendProviderEmail(config, {
    to: recipient,
    subject: `Welfare Pride delivery test — ${displayName}`,
    html: `<p>This is a secure delivery test from <strong>${displayName}</strong>.</p><p>Provider: ${config.provider === "microsoft_graph" ? "Microsoft Graph API" : "SMTP"}. If this message arrived, the connection and configured sender settings were accepted.</p>`,
  });
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] || character));
}
