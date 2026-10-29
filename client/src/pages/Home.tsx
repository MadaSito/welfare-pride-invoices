import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { ArrowUpRight, Banknote, Clock3, FileText, Send, WalletCards } from "lucide-react";
import { Link } from "wouter";

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default function Home() {
  const { activeCompany, loading } = useWorkspace();
  const invoices = trpc.invoices.list.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany) });
  if (loading) return <div className="app-loading"><span className="loading-orb" />Preparing your workspace…</div>;
  if (!activeCompany) return <div className="empty-state"><FileText size={30} /><h3>No company access yet</h3><p>Ask a platform administrator to give your signed-in account a company role before creating or viewing invoices.</p></div>;

  const rows = invoices.data ?? [];
  const paid = rows.filter(row => row.invoice.status === "paid").reduce((sum, row) => sum + row.invoice.totalCents, 0);
  const outstanding = rows.filter(row => ["sent", "finalized"].includes(row.invoice.status)).reduce((sum, row) => sum + row.invoice.totalCents, 0);
  const draftCount = rows.filter(row => row.invoice.status === "draft").length;
  const sentCount = rows.filter(row => row.invoice.status === "sent").length;

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Invoice operations</span><h1>Good morning, {activeCompany.name}.</h1><p>Keep your billing cycle moving with organized records, clear PDF documents, and traceable delivery.</p></div>
      <div className="page-heading-actions"><Link href="/invoices/new" className="button button-primary"><FileText size={16} />Create invoice</Link></div>
    </div>
    <section className="metric-grid" aria-label="Invoice summary">
      <article className="metric-card"><WalletCards className="metric-icon" size={21} /><span className="metric-label">Paid invoices</span><strong className="metric-value">{money(paid)}</strong><span className="metric-caption">Collected across all invoices</span></article>
      <article className="metric-card orange"><Banknote className="metric-icon" size={21} /><span className="metric-label">Outstanding</span><strong className="metric-value">{money(outstanding)}</strong><span className="metric-caption">Finalized or sent to clients</span></article>
      <article className="metric-card"><Clock3 className="metric-icon" size={21} /><span className="metric-label">Drafts in progress</span><strong className="metric-value">{draftCount}</strong><span className="metric-caption">Ready to review before delivery</span></article>
      <article className="metric-card"><Send className="metric-icon" size={21} /><span className="metric-label">Sent this workspace</span><strong className="metric-value">{sentCount}</strong><span className="metric-caption">Email delivery is recorded in logs</span></article>
    </section>
    <section className="two-column">
      <article className="panel">
        <div className="panel-header"><div><h2>Recent invoices</h2><p>Latest document and delivery activity.</p></div><Link href="/invoices" className="link-button">View all <ArrowUpRight size={13} /></Link></div>
        <div className="table-scroll">{rows.length ? <table className="data-table"><thead><tr><th>Invoice</th><th>Client</th><th>Due date</th><th>Status</th><th className="number">Total</th></tr></thead><tbody>{rows.slice(0, 6).map(({ invoice, contact }) => <tr key={invoice.id}><td><strong>{invoice.invoiceNumber}</strong></td><td>{contact.companyName}</td><td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(invoice.dueDate)}</td><td><span className={`status status-${invoice.status}`}>{invoice.status}</span></td><td className="number"><strong>{money(invoice.totalCents, invoice.currency)}</strong></td></tr>)}</tbody></table> : <div className="empty-state"><FileText size={28} /><h3>No invoices yet</h3><p>Create your first branded invoice when you are ready.</p><Link href="/invoices/new" className="button button-secondary">Start an invoice</Link></div>}</div>
      </article>
      <aside className="stack">
        <article className="panel"><div className="panel-header"><div><h2>Ready for delivery</h2><p>Before sending a client invoice.</p></div></div><div className="panel-body"><div className="notice notice-info"><Send size={16} /><span>PDFs are generated on the server with your selected company branding. Set a delivery provider before your first send.</span></div><div className="form-footer"><Link href="/delivery" className="button button-secondary">Configure delivery</Link></div></div></article>
        <article className="panel"><div className="panel-header"><div><h2>Brand integrity</h2><p>Your logo is proportionally fitted.</p></div></div><div className="panel-body"><div className="brand-preview"><div className="preview-brand"><img src={activeCompany.logoKey ? `/api/assets/${activeCompany.logoKey}` : "/brand/welfare-pride-logo.png"} alt={`${activeCompany.name} logo`} style={{ maxWidth: `${Math.min(160, Math.max(50, activeCompany.logoScale || 100))}%` }} /><span className="preview-title">INVOICE</span></div><span className="brand-preview-note">Logo fit: {activeCompany.logoScale || 100}% · {activeCompany.logoAlignment || "left"} aligned</span><div className="dot-pattern" /></div></div></article>
      </aside>
    </section>
  </>;
}
