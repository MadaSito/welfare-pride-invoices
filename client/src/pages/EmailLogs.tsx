import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ClipboardCheck, MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function EmailLogs() {
  const { activeCompany, isPlatformAdmin } = useWorkspace();
  const canAdminister = isPlatformAdmin || activeCompany?.memberRole === "platform_admin";
  const utils = trpc.useUtils();
  const logs = trpc.delivery.logs.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany && canAdminister) });
  const reconcile = trpc.invoices.reconcileUncertainDelivery.useMutation({
    onSuccess: (_, input) => { toast.success(input.resolution === "mark_sent" ? "Invoice marked delivered after administrator reconciliation." : "Invoice returned to finalized so a creator can retry after verifying the provider outcome."); utils.delivery.logs.invalidate(); utils.invoices.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  if (!activeCompany) return <div className="empty-state"><MailCheck size={30} /><h3>No active company</h3><p>Delivery logs require a company role.</p></div>;
  if (!canAdminister) return <div className="empty-state"><ShieldCheck size={30} /><h3>Administrator access required</h3><p>Only company administrators can review delivery audit logs.</p></div>;
  return <>
    <div className="page-heading"><div><span className="eyebrow">Delivery audit</span><h1>Email logs</h1><p>Review the delivery provider, recipient, BCC archive target, correlation record, and result for each invoice or test message.</p></div></div>
    <section className="panel"><div className="panel-header"><div><h2>Recent delivery activity</h2><p>Up to the latest 100 events for {activeCompany.name}.</p></div></div><div className="table-scroll">{logs.isLoading ? <div className="empty-state">Loading secure delivery logs…</div> : logs.data?.length ? <table className="data-table"><thead><tr><th>Date</th><th>Recipient</th><th>Subject</th><th>Provider</th><th>Status</th><th>Correlation</th><th>Safe response summary</th><th /></tr></thead><tbody>{logs.data.map(log => <tr key={log.id}><td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(log.createdAt)}</td><td>{log.recipient}{log.bcc && <><br /><small style={{ color: "var(--muted)" }}>BCC: {log.bcc}</small></>}</td><td><strong>{log.subject}</strong></td><td>{log.provider === "microsoft_graph" ? "Microsoft Graph" : "SMTP"}</td><td><span className={`status status-${log.status}`}>{log.status}</span></td><td><code style={{ color: "var(--muted)", fontSize: 10 }}>{log.correlationId.slice(0, 13)}…</code></td><td style={{ maxWidth: 260 }}>{log.responseSummary || "Awaiting provider response."}</td><td>{log.status === "uncertain" && log.invoiceId ? <div style={{ display: "grid", gap: 7, minWidth: 146 }}><span style={{ display: "inline-flex", gap: 4, alignItems: "center", color: "var(--danger)", fontSize: 10 }}><AlertTriangle size={12} />Verify provider first</span><button className="link-button" disabled={reconcile.isPending} onClick={() => { if (window.confirm("Confirm that the provider accepted this invoice. This marks it sent and does not send another email.")) reconcile.mutate({ companyId: activeCompany.id, invoiceId: log.invoiceId!, resolution: "mark_sent" }); }}>Mark delivered</button><button className="link-button" disabled={reconcile.isPending} onClick={() => { if (window.confirm("Only continue if you verified the provider did not send this invoice. This enables a manual retry; it does not send an email now.")) reconcile.mutate({ companyId: activeCompany.id, invoiceId: log.invoiceId!, resolution: "retry" }); }}>Enable safe retry</button></div> : null}</td></tr>)}</tbody></table> : <div className="empty-state"><ClipboardCheck size={30} /><h3>No delivery events yet</h3><p>Provider tests and sent invoices will appear here with durable status records.</p></div>}</div></section>
  </>;
}
