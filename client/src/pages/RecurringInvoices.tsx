import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CalendarClock, Hash, Mail, MinusCircle, Pause, Play, Plus, ReceiptText, Save, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type ScheduleItem = { description: string; quantity: number; unitPrice: string; taxable: boolean };
type Cadence = "daily" | "weekly" | "monthly" | "semiannual" | "yearly";
const blankItem: ScheduleItem = { description: "", quantity: 1, unitPrice: "0.00", taxable: true };
const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const cents = (value: string) => Math.max(0, Math.round((Number(value) || 0) * 100));
const isoDateTime = (value?: Date | string | null) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) : "Awaiting scheduler";
const seriesNumber = (prefix: string, sequence: number) => `${prefix || "REC"}${String(sequence || 1).padStart(3, "0")}`;
const validPrefix = (value: string) => /^[A-Z0-9]{1,24}$/.test(value) && value !== "DRAFT";
const needsMonthDay = (cadence: Cadence) => cadence === "monthly" || cadence === "semiannual" || cadence === "yearly";
const needsMonthAnchor = (cadence: Cadence) => cadence === "semiannual" || cadence === "yearly";

function cadenceLabel(schedule: any) {
  const time = `${String(schedule.hourUtc).padStart(2, "0")}:${String(schedule.minuteUtc).padStart(2, "0")} UTC`;
  if (schedule.cadence === "daily") return <>Daily<br /><small style={{ color: "var(--muted)" }}>{time}</small></>;
  if (schedule.cadence === "weekly") return <>{weekday[schedule.dayOfWeek ?? 0]}s<br /><small style={{ color: "var(--muted)" }}>{time}</small></>;
  if (schedule.cadence === "monthly") return <>Monthly · day {schedule.dayOfMonth}<br /><small style={{ color: "var(--muted)" }}>{time}</small></>;
  if (schedule.cadence === "semiannual") {
    const first = schedule.monthOfYear ?? 1;
    return <>Every 6 months · {months[first - 1]} &amp; {months[first + 5]} {schedule.dayOfMonth}<br /><small style={{ color: "var(--muted)" }}>{time}</small></>;
  }
  return <>Yearly · {months[(schedule.monthOfYear ?? 1) - 1]} {schedule.dayOfMonth}<br /><small style={{ color: "var(--muted)" }}>{time}</small></>;
}

export default function RecurringInvoices() {
  const { activeCompany } = useWorkspace();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [monthOfYear, setMonthOfYear] = useState("1");
  const [hourUtc, setHourUtc] = useState("9");
  const [minuteUtc, setMinuteUtc] = useState("0");
  const [dueDays, setDueDays] = useState("30");
  const [autoSend, setAutoSend] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [seriesPrefix, setSeriesPrefix] = useState("REC");
  const [nextSeriesSequence, setNextSeriesSequence] = useState("1");
  const [taxRate, setTaxRate] = useState("0");
  const [discountRate, setDiscountRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("Payment due within 30 days.");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [items, setItems] = useState<ScheduleItem[]>([{ ...blankItem }]);
  const [numberingScheduleId, setNumberingScheduleId] = useState<number | null>(null);
  const [numberingPrefix, setNumberingPrefix] = useState("");
  const [numberingSequence, setNumberingSequence] = useState("");

  const canCreate = activeCompany?.memberRole === "company_creator" || activeCompany?.memberRole === "platform_admin";
  const canAdminister = activeCompany?.memberRole === "platform_admin";
  const contacts = trpc.contacts.list.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany) });
  const schedules = trpc.recurringInvoices.list.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany) });
  const delivery = trpc.delivery.configuration.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany && canAdminister) });

  useEffect(() => {
    if (!open) {
      setSeriesPrefix("REC");
      setNextSeriesSequence("1");
    }
  }, [activeCompany?.id, open]);

  const resetScheduleForm = () => {
    setOpen(false);
    setName("");
    setContactId("");
    setCadence("monthly");
    setDayOfWeek("1");
    setDayOfMonth("1");
    setMonthOfYear("1");
    setAutoSend(false);
    setSeriesPrefix("REC");
    setNextSeriesSequence("1");
    setItems([{ ...blankItem }]);
  };

  const create = trpc.recurringInvoices.create.useMutation({
    onSuccess: () => { toast.success("Recurring invoice schedule created."); resetScheduleForm(); utils.recurringInvoices.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const setActive = trpc.recurringInvoices.setActive.useMutation({
    onSuccess: (_, input) => { toast.success(input.isActive ? "Schedule resumed." : "Schedule paused."); utils.recurringInvoices.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const updateSeries = trpc.recurringInvoices.setInvoiceSequence.useMutation({
    onSuccess: schedule => {
      toast.success(`Recurring series updated. Next invoice: ${seriesNumber(schedule.invoicePrefix, schedule.invoiceSequence)}.`);
      setNumberingScheduleId(null);
      utils.recurringInvoices.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.recurringInvoices.delete.useMutation({
    onSuccess: () => { toast.success("Recurring schedule archived. Its invoice series remains protected."); utils.recurringInvoices.list.invalidate(); },
    onError: error => toast.error(error.message),
  });

  const estimatedTotal = useMemo(() => items.reduce((sum, item) => sum + Math.max(1, item.quantity || 1) * cents(item.unitPrice), 0), [items]);
  const setItem = (index: number, patch: Partial<ScheduleItem>) => setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  const save = () => {
    const nextNumber = Number(nextSeriesSequence);
    const anchorMonth = Number(monthOfYear);
    if (!activeCompany || !name.trim() || !contactId) { toast.error("Provide a schedule name and client."); return; }
    if (!validPrefix(seriesPrefix.trim().toUpperCase())) { toast.error("Use 1–24 letters or numbers for the recurring invoice prefix; DRAFT is reserved."); return; }
    if (!Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber > 99_999_999) { toast.error("Enter a whole next series number between 1 and 99,999,999."); return; }
    if (needsMonthDay(cadence) && (!Number.isSafeInteger(Number(dayOfMonth)) || Number(dayOfMonth) < 1 || Number(dayOfMonth) > 28)) { toast.error("Choose a day of month from 1 to 28."); return; }
    if (cadence === "semiannual" && (!Number.isSafeInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 6)) { toast.error("For every six months, choose an anchor month from January through June."); return; }
    if (cadence === "yearly" && (!Number.isSafeInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12)) { toast.error("Choose a month for the yearly schedule."); return; }
    if (items.some(item => !item.description.trim())) { toast.error("Each recurring invoice line needs a description."); return; }
    if (autoSend && (!canAdminister || !delivery.data?.configured)) { toast.error("Automatic delivery requires a company administrator and an active email provider."); return; }
    create.mutate({
      companyId: activeCompany.id,
      name: name.trim(),
      contactId: Number(contactId),
      invoicePrefix: seriesPrefix.trim().toUpperCase(),
      nextInvoiceSequence: nextNumber,
      cadence,
      dayOfWeek: cadence === "weekly" ? Number(dayOfWeek) : null,
      dayOfMonth: needsMonthDay(cadence) ? Number(dayOfMonth) : null,
      monthOfYear: needsMonthAnchor(cadence) ? anchorMonth : null,
      hourUtc: Number(hourUtc),
      minuteUtc: Number(minuteUtc),
      dueDays: Number(dueDays),
      autoSend,
      currency,
      taxRateBps: Math.round((Number(taxRate) || 0) * 100),
      discountRateBps: Math.round((Number(discountRate) || 0) * 100),
      notes: notes || null,
      terms: terms || null,
      paymentInstructions: paymentInstructions || null,
      lineItems: items.map(item => ({ description: item.description.trim(), quantity: Math.max(1, Number(item.quantity) || 1), unitPriceCents: cents(item.unitPrice), taxable: item.taxable })),
    });
  };

  const saveSeries = (scheduleId: number) => {
    const prefix = numberingPrefix.trim().toUpperCase();
    const nextNumber = Number(numberingSequence);
    if (!activeCompany) return;
    if (!validPrefix(prefix)) { toast.error("Use 1–24 letters or numbers for the recurring invoice prefix; DRAFT is reserved."); return; }
    if (!Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber > 99_999_999) { toast.error("Enter a whole next series number between 1 and 99,999,999."); return; }
    if (window.confirm(`Set this recurring schedule's next invoice to ${seriesNumber(prefix, nextNumber)}? Existing invoices will not change.`)) {
      updateSeries.mutate({ companyId: activeCompany.id, scheduleId, invoicePrefix: prefix, nextInvoiceSequence: nextNumber });
    }
  };

  if (!activeCompany) return <div className="empty-state"><CalendarClock size={30} /><h3>No active company</h3><p>Select a company to manage its recurring invoice schedules.</p></div>;
  if (!canCreate) return <div className="empty-state"><AlertTriangle size={30} /><h3>Creator access required</h3><p>Your role can view invoices but cannot configure recurring invoice templates.</p><Link href="/invoices" className="button button-secondary">Back to invoices</Link></div>;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Automated billing</span><h1>Recurring invoices</h1><p>Each recurring schedule owns its own invoice series. Financial numbers are reserved only when a document is sent.</p></div><div className="page-heading-actions"><button className="button button-primary" onClick={() => setOpen(true)}><Plus size={16} />New schedule</button></div></div>
    <div className="notice notice-info" style={{ marginBottom: 20 }}><CalendarClock size={17} /><span><strong>Safe by default:</strong> choose daily, weekly, monthly, every-six-months, or yearly timing in UTC. Schedules create a finalized invoice for review unless automatic delivery is explicitly enabled.</span></div>
    {open && <section className="panel" style={{ marginBottom: 20 }}><div className="panel-header"><div><h2>Create recurring invoice</h2><p>All run times are in UTC. For six-month and yearly schedules, set the anchor month and day explicitly.</p></div></div><div className="panel-body">
      <div className="form-grid three"><div className="form-field"><label>Schedule name</label><input className="field-input" placeholder="Monthly care coordination" value={name} onChange={event => setName(event.target.value)} /></div><div className="form-field"><label>Client</label><select className="field-select" value={contactId} onChange={event => setContactId(event.target.value)}><option value="">Select saved client</option>{contacts.data?.map(contact => <option key={contact.id} value={contact.id}>{contact.companyName}{contact.contactName ? ` — ${contact.contactName}` : ""}</option>)}</select></div><div className="form-field"><label>Currency</label><select className="field-select" value={currency} onChange={event => setCurrency(event.target.value)}><option>USD</option><option>CAD</option><option>EUR</option><option>GBP</option></select></div></div>
      {!contacts.data?.length && <div className="notice notice-warn" style={{ marginTop: 14 }}><AlertTriangle size={17} /><span>Add a client before creating a recurring schedule. <Link href="/clients" className="link-button">Go to clients</Link></span></div>}
      <div className="recurring-series-setup"><Hash size={18} /><div><strong>Recurring invoice series</strong><p>Set the prefix and the next number for this schedule only. For the sample invoices <code>HPP033</code> and <code>HPP034</code>, use prefix <strong>HPP</strong> and next number <strong>35</strong>.</p></div><div className="recurring-series-fields"><label>Prefix<input className="field-input" maxLength={24} value={seriesPrefix} onChange={event => setSeriesPrefix(event.target.value.toUpperCase())} /></label><label>Next number<input className="field-input" type="number" min="1" max="99999999" value={nextSeriesSequence} onChange={event => setNextSeriesSequence(event.target.value)} /></label><span>Next: <strong>{seriesNumber(seriesPrefix, Number(nextSeriesSequence) || 1)}</strong></span></div></div>
      <div className="form-grid three" style={{ marginTop: 18 }}>
        <div className="form-field"><label>Cadence</label><select className="field-select" value={cadence} onChange={event => setCadence(event.target.value as Cadence)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="semiannual">Every 6 months</option><option value="yearly">Yearly</option></select></div>
        {cadence === "weekly" && <div className="form-field"><label>Day of week</label><select className="field-select" value={dayOfWeek} onChange={event => setDayOfWeek(event.target.value)}>{weekday.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></div>}
        {needsMonthDay(cadence) && <div className="form-field"><label>Day of month</label><input className="field-input" type="number" min="1" max="28" value={dayOfMonth} onChange={event => setDayOfMonth(event.target.value)} /></div>}
        {needsMonthAnchor(cadence) && <div className="form-field"><label>{cadence === "semiannual" ? "First occurrence month" : "Month"}</label><select className="field-select" value={monthOfYear} onChange={event => setMonthOfYear(event.target.value)}>{months.slice(0, cadence === "semiannual" ? 6 : 12).map((month, index) => <option key={month} value={index + 1}>{month}{cadence === "semiannual" ? ` & ${months[index + 6]}` : ""}</option>)}</select></div>}
        {cadence === "daily" && <div className="form-field"><label>Schedule timing</label><div className="field-input" style={{ display: "flex", alignItems: "center" }}>Every day</div></div>}
        <div className="form-field"><label>Run at (UTC)</label><div style={{ display: "flex", gap: 8 }}><input className="field-input" type="number" min="0" max="23" aria-label="Hour UTC" value={hourUtc} onChange={event => setHourUtc(event.target.value)} /><input className="field-input" type="number" min="0" max="59" aria-label="Minute UTC" value={minuteUtc} onChange={event => setMinuteUtc(event.target.value)} /></div></div><div className="form-field"><label>Due days</label><input className="field-input" type="number" min="0" max="365" value={dueDays} onChange={event => setDueDays(event.target.value)} /></div><div className="form-field"><label>Tax rate (%)</label><input className="field-input" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={event => setTaxRate(event.target.value)} /></div><div className="form-field"><label>Discount (%)</label><input className="field-input" type="number" min="0" max="100" step="0.01" value={discountRate} onChange={event => setDiscountRate(event.target.value)} /></div>
      </div>
      {cadence === "semiannual" && <div className="notice notice-info" style={{ marginTop: 14 }}><CalendarClock size={17} /><span>This schedule will run on day {dayOfMonth || "1"} of {months[(Number(monthOfYear) || 1) - 1]} and {months[(Number(monthOfYear) || 1) + 5]} each year.</span></div>}
      <section className="subpanel" style={{ marginTop: 18 }}><div className="panel-header"><div><h3>Recurring line items</h3><p>Estimated subtotal: {new Intl.NumberFormat("en-US", { style: "currency", currency }).format(estimatedTotal / 100)}</p></div><button className="button button-secondary" onClick={() => setItems(current => [...current, { ...blankItem }])}><Plus size={15} />Add line</button></div><div className="panel-body"><div className="invoice-line-scroll"><table className="invoice-lines"><thead><tr><th className="line-description">Description</th><th>Quantity</th><th>Unit price</th><th>Taxable</th><th /></tr></thead><tbody>{items.map((item, index) => <tr key={index}><td><input className="field-input" placeholder="Service or product" value={item.description} onChange={event => setItem(index, { description: event.target.value })} /></td><td><input className="field-input" type="number" min="1" value={item.quantity} onChange={event => setItem(index, { quantity: Number(event.target.value) })} /></td><td><input className="field-input" inputMode="decimal" value={item.unitPrice} onChange={event => setItem(index, { unitPrice: event.target.value })} /></td><td style={{ textAlign: "center" }}><input type="checkbox" checked={item.taxable} onChange={event => setItem(index, { taxable: event.target.checked })} aria-label="Taxable line" /></td><td><button className="remove-line" disabled={items.length === 1} onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove line"><MinusCircle size={16} /></button></td></tr>)}</tbody></table></div></div></section>
      <div className="form-grid" style={{ marginTop: 18 }}><div className="form-field"><label>Payment instructions</label><textarea className="field-textarea" value={paymentInstructions} onChange={event => setPaymentInstructions(event.target.value)} /></div><div className="form-field"><label>Terms &amp; conditions</label><textarea className="field-textarea" value={terms} onChange={event => setTerms(event.target.value)} /></div><div className="form-field"><label>Client-facing notes</label><textarea className="field-textarea" value={notes} onChange={event => setNotes(event.target.value)} /></div></div>
      <label className="checkbox-row" style={{ marginTop: 18 }}><input type="checkbox" checked={autoSend} disabled={!canAdminister || !delivery.data?.configured} onChange={event => setAutoSend(event.target.checked)} /><span><strong>Automatically email this invoice</strong><small>{canAdminister ? delivery.data?.configured ? "Uses the current protected company email provider." : "Configure Graph or SMTP first." : "Company administrator permission is required."}</small></span><Mail size={17} /></label>
      <div className="form-footer"><button className="button button-secondary" onClick={resetScheduleForm}>Cancel</button><button className="button button-primary" disabled={create.isPending} onClick={save}>{create.isPending ? "Scheduling…" : "Create schedule"}</button></div></div></section>}
    <section className="panel"><div className="panel-header"><div><h2>Company schedules</h2><p>{schedules.data?.length ?? 0} recurring invoice schedule{schedules.data?.length === 1 ? "" : "s"} in {activeCompany.name}.</p></div></div><div className="table-scroll">{schedules.isLoading ? <div className="empty-state">Loading schedules…</div> : schedules.data?.length ? <table className="data-table"><thead><tr><th>Schedule</th><th>Client</th><th>Invoice series</th><th>Cadence</th><th>Delivery</th><th>Next run (UTC)</th><th>Status</th><th /></tr></thead><tbody>{schedules.data.map(({ schedule, contact }) => <Fragment key={schedule.id}><tr><td><strong>{schedule.name}</strong><br /><small style={{ color: "var(--muted)" }}>{schedule.currency} · due in {schedule.dueDays} day{schedule.dueDays === 1 ? "" : "s"}</small></td><td>{contact.companyName}</td><td><strong>{seriesNumber(schedule.invoicePrefix, schedule.invoiceSequence)}</strong><br /><small style={{ color: "var(--muted)" }}>next in {schedule.invoicePrefix} series</small>{canAdminister && <button className="link-button" style={{ display: "block", marginTop: 5 }} onClick={() => { setNumberingScheduleId(schedule.id); setNumberingPrefix(schedule.invoicePrefix); setNumberingSequence(String(schedule.invoiceSequence)); }}><Hash size={13} />Set next number</button>}</td><td>{cadenceLabel(schedule)}</td><td>{schedule.autoSend ? <span className="status status-sent">Auto-send</span> : <span className="status status-finalized">Review first</span>}</td><td>{isoDateTime(schedule.nextRunAt)}</td><td><span className={`status ${schedule.isActive ? "status-paid" : "status-draft"}`}>{schedule.isActive ? "active" : "paused"}</span></td><td><div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><button className="link-button" disabled={setActive.isPending} onClick={() => setActive.mutate({ companyId: activeCompany.id, scheduleId: schedule.id, isActive: !schedule.isActive })}>{schedule.isActive ? <><Pause size={14} />Pause</> : <><Play size={14} />Resume</>}</button><button className="link-button" disabled={remove.isPending} onClick={() => { if (window.confirm(`Archive the “${schedule.name}” recurring invoice schedule? It will stop running, but its invoices and number series remain protected.`)) remove.mutate({ companyId: activeCompany.id, scheduleId: schedule.id }); }}><Trash2 size={14} />Archive</button></div></td></tr>{numberingScheduleId === schedule.id && <tr className="recurring-series-editor-row"><td colSpan={8}><div className="recurring-series-editor"><Hash size={18} /><div><strong>Set this schedule’s next invoice</strong><small>For HPP033 and HPP034, set prefix <b>HPP</b> and next number <b>35</b>. Existing invoice files will not change.</small></div><label>Prefix<input className="field-input" maxLength={24} value={numberingPrefix} onChange={event => setNumberingPrefix(event.target.value.toUpperCase())} /></label><label>Next number<input className="field-input" type="number" min="1" max="99999999" value={numberingSequence} onChange={event => setNumberingSequence(event.target.value)} /></label><strong className="recurring-series-preview">Next: {seriesNumber(numberingPrefix, Number(numberingSequence) || 1)}</strong><button className="button button-secondary" onClick={() => setNumberingScheduleId(null)}>Cancel</button><button className="button button-primary" disabled={updateSeries.isPending} onClick={() => saveSeries(schedule.id)}><Save size={15} />{updateSeries.isPending ? "Saving…" : "Save series"}</button></div></td></tr>}</Fragment>)}</tbody></table> : <div className="empty-state"><ReceiptText size={30} /><h3>No recurring schedules</h3><p>Create a daily, weekly, monthly, six-month, or yearly template to keep regular invoices on time.</p><button className="button button-primary" onClick={() => setOpen(true)}>Create schedule</button></div>}</div></section>
  </>;
}
