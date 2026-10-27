import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { Download, FilePlus2, Mail, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

function money(cents: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }

export default function Invoices() {
  const { activeCompany } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.invoices.list.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany) });
  const canCreate = activeCompany?.memberRole === "company_creator" || activeCompany?.memberRole === "platform_admin";
  const finalize = trpc.invoices.finalize.useMutation({ onSuccess: () => { toast.success("Invoice finalized."); utils.invoices.list.invalidate(); } });
  const send = trpc.invoices.send.useMutation({ onSuccess: () => { toast.success("Invoice sent and logged."); utils.invoices.list.invalidate(); utils.delivery.logs.invalidate(); }, onError: error => toast.error(error.message) });

  if (!activeCompany) return <div className="empty-state"><ShieldAlert size={30} /><h3>No active company</h3><p>You need a company membership to access invoices.</p></div>;
  const rows = query.data ?? [];
  return <>
    <div className="page-heading"><div><span className="eyebrow">Documents</span><h1>Invoices</h1><p>Create, review, download, and securely deliver branded financial documents.</p></div>{canCreate && <div className="page-heading-actions"><Link href="/invoices/new" className="button button-primary"><FilePlus2 size={16} />New invoice</Link></div>}</div>
    <article className="panel"><div className="panel-header"><div><h2>All company invoices</h2><p>{rows.length} document{rows.length === 1 ? "" : "s"} in {activeCompany.name}.</p></div></div><div className="table-scroll">{query.isLoading ? <div className="empty-state">Loading invoices…</div> : rows.length ? <table className="data-table"><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th className="number">Total</th><th aria-label="Actions" /></tr></thead><tbody>{rows.map(({ invoice, contact }) => <tr key={invoice.id}><td><strong>{invoice.invoiceNumber}</strong><br /><small style={{ color: "var(--muted)" }}>{invoice.currency}</small></td><td>{contact.companyName}<br /><small style={{ color: "var(--muted)" }}>{contact.email || "No email"}</small></td><td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(invoice.issueDate)}</td><td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(invoice.dueDate)}</td><td><span className={`status status-${invoice.status}`}>{invoice.status}</span></td><td className="number"><strong>{money(invoice.totalCents, invoice.currency)}</strong></td><td><div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}><a className="link-button" href={`/api/invoices/${invoice.id}/pdf?companyId=${activeCompany.id}`}><Download size={14} /> PDF</a>{canCreate && invoice.status === "draft" && <><Link href={`/invoices/${invoice.id}/edit`} className="link-button">Edit</Link><button className="link-button" disabled={finalize.isPending} onClick={() => finalize.mutate({ companyId: activeCompany.id, invoiceId: invoice.id })}>Finalize</button></>}{canCreate && invoice.status === "finalized" && <button className="link-button" disabled={send.isPending} onClick={() => send.mutate({ companyId: activeCompany.id, invoiceId: invoice.id })}><Mail size={14} />Send</button>}</div></td></tr>)}</tbody></table> : <div className="empty-state"><Send size={30} /><h3>No invoices in this company</h3><p>{canCreate ? "Create a draft to start the secure document and delivery workflow." : "Invoices you are permitted to view will appear here."}</p>{canCreate && <Link href="/invoices/new" className="button button-primary">Create invoice</Link>}</div>}</div></article>
  </>;
}
