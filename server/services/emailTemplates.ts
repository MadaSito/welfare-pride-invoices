import sanitizeHtml from "sanitize-html";
import { escapeHtml } from "./mailer";

export const EMAIL_TEMPLATE_VARIABLES = [
  "invoiceNumber",
  "companyName",
  "clientName",
  "invoiceTotal",
  "currency",
  "issueDate",
  "dueDate",
  "paymentInstructions",
] as const;

type TemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number];
export type InvoiceEmailTemplateContext = Record<TemplateVariable, string>;

const variablePattern = /{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g;
const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ["a", "b", "br", "div", "em", "h1", "h2", "h3", "li", "ol", "p", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"],
  allowedAttributes: { a: ["href", "title", "target"], span: ["style"], td: ["colspan", "rowspan", "style"], th: ["colspan", "rowspan", "style"], p: ["style"], div: ["style"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-fA-F]{3,8}$/],
      "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/],
      "font-weight": [/^(?:normal|bold|[1-9]00)$/],
      "text-align": [/^(?:left|center|right)$/],
      "font-family": [/^[A-Za-z0-9 ,"'-]{1,80}$/],
    },
  },
  disallowedTagsMode: "discard",
};

function validateVariables(value: string, field: "subject" | "body") {
  for (const match of value.matchAll(variablePattern)) {
    if (!EMAIL_TEMPLATE_VARIABLES.includes(match[1] as TemplateVariable)) {
      throw new Error(`The ${field} uses an unsupported placeholder: {{${match[1]}}}.`);
    }
  }
}

export function validateEmailTemplate(input: { subjectTemplate: string; htmlBodyTemplate: string }) {
  const subjectTemplate = input.subjectTemplate.replace(/[\r\n]/g, " ").trim();
  if (!subjectTemplate || subjectTemplate.length > 300) throw new Error("The email subject must contain 1–300 characters and cannot contain line breaks.");
  if (!input.htmlBodyTemplate.trim() || input.htmlBodyTemplate.length > 20_000) throw new Error("The email body must contain 1–20,000 characters.");
  validateVariables(subjectTemplate, "subject");
  validateVariables(input.htmlBodyTemplate, "body");
  const htmlBodyTemplate = sanitizeHtml(input.htmlBodyTemplate, sanitizeOptions).trim();
  if (!htmlBodyTemplate) throw new Error("The email body has no permitted HTML after security sanitization.");
  return { subjectTemplate, htmlBodyTemplate };
}

function resolve(value: string, context: InvoiceEmailTemplateContext, html: boolean) {
  return value.replace(variablePattern, (_whole, key: string) => {
    const resolved = context[key as TemplateVariable] ?? "";
    return html ? escapeHtml(resolved) : resolved.replace(/[\r\n]/g, " ");
  });
}

export function renderInvoiceEmailTemplate(template: { subjectTemplate: string; htmlBodyTemplate: string }, context: InvoiceEmailTemplateContext) {
  const safe = validateEmailTemplate(template);
  return { subject: resolve(safe.subjectTemplate, context, false).slice(0, 300), html: resolve(safe.htmlBodyTemplate, context, true) };
}
