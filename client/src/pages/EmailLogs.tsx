import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { ClipboardCheck, MailCheck, ShieldCheck } from "lucide-react";

export default function EmailLogs() {
  const { activeCompany, isPlatformAdmin } = useWorkspace();
  const canAdminister = isPlatformAdmin || activeCompany?.memberRole === "platform_admin";
  const logs = trpc.delivery.logs.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany && canAdminister) });
  if (!activeCompany) return <div className="empty-state"><MailCheck size={30} /><h3>No active company</h3><p>Delivery logs require a company role.</p></div>;
  if (!canAdminister) return <div className="empty-state"><ShieldCheck size={30} /><h3>Administrator access required</h3><p>Only company administrators can review delivery audit logs.</p></div>;
  return <>
    <div className="page-heading"><div><span className="eyebrow">Delivery audit</span><h1>Email logs</h1><p>Review the delivery provider, recipient, BCC archive target, correlation record, and result for each invoice or test message.</p></div></div>
    <section className="panel"><div className="panel-header"><div><h2>Recent delivery activity</h2><p>Up to the latest 100 events for {activeCompany.name}.</p></div></div><div className="table-scroll">{logs.isLoading ? <div className="empty-state">Loading secure delivery logs…</div> : logs.data?.length ? <table className="data-table"><thead><tr><th>Date</th><th>Recipient</th><th>Subject</th><th>Provider</th><th>Status</th><th>Correlation</th><th>Safe response summary</th></tr></thead><tbody>{logs.data.map(log => <tr key={log.id}><td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(log.createdAt)}</td><td>{log.recipient}{log.bcc && <><br /><small style={{ color: "var(--muted)" }}>BCC: {log.bcc}</small></>}</td><td><strong>{log.subject}</strong></td><td>{log.provider === "microsoft_graph" ? "Microsoft Graph" : "SMTP"}</td><td><span className={`status status-${log.status}`}>{log.status}</span></td><td><code style={{ color: "var(--muted)", fontSize: 10 }}>{log.correlationId.slice(0, 13)}…</code></td><td style={{ maxWidth: 260 }}>{log.responseSummary || "Awaiting provider response."}</td></tr>)}</tbody></table> : <div className="empty-state"><ClipboardCheck size={30} /><h3>No delivery events yet</h3><p>Provider tests and sent invoices will appear here with durable status records.</p></div>}</div></section>
  </>;
}
