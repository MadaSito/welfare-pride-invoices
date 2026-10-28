import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ImageUp, MapPin, Palette, Save, ShieldCheck } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type BrandForm = {
  name: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
  defaultBcc: string;
  logoScale: number;
  logoAlignment: "left" | "right";
  invoicePrefix: string;
};

const blank: BrandForm = {
  name: "", legalName: "", email: "", phone: "", website: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", country: "US",
  primaryColor: "#5A92C9", accentColor: "#D58240", footerText: "", defaultBcc: "", logoScale: 100, logoAlignment: "left", invoicePrefix: "INV",
};

function fromCompany(company: any): BrandForm {
  return {
    name: company.name || "", legalName: company.legalName || "", email: company.email || "", phone: company.phone || "", website: company.website || "",
    addressLine1: company.addressLine1 || "", addressLine2: company.addressLine2 || "", city: company.city || "", region: company.region || "", postalCode: company.postalCode || "", country: company.country || "US",
    primaryColor: company.primaryColor || "#5A92C9", accentColor: company.accentColor || "#D58240", footerText: company.footerText || "", defaultBcc: company.defaultBcc || "", logoScale: company.logoScale || 100, logoAlignment: company.logoAlignment || "left", invoicePrefix: company.invoicePrefix || "INV",
  };
}

function senderAddressLines(form: BrandForm) {
  const locality = [form.city.trim(), form.region.trim(), form.postalCode.trim()].filter(Boolean).join(", ");
  return [form.addressLine1.trim(), form.addressLine2.trim(), locality, form.country.trim()].filter(Boolean);
}

export default function Branding() {
  const { activeCompany, isPlatformAdmin, refresh } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.company.get.useQuery({ companyId: activeCompany?.id ?? 0 }, { enabled: Boolean(activeCompany) });
  const [form, setForm] = useState<BrandForm>(blank);
  useEffect(() => { if (query.data) setForm(fromCompany(query.data)); }, [query.data]);
  const canAdminister = isPlatformAdmin || activeCompany?.memberRole === "platform_admin";
  const addressLines = useMemo(() => senderAddressLines(form), [form]);
  const update = trpc.company.updateBranding.useMutation({
    onSuccess: async () => { toast.success("Company identity and invoicing address saved."); await refresh(); utils.company.get.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const upload = trpc.company.uploadLogo.useMutation({
    onSuccess: async () => { toast.success("Company logo uploaded. It will always retain its aspect ratio in PDFs."); await refresh(); utils.company.get.invalidate(); },
    onError: error => toast.error(error.message),
  });

  if (!activeCompany) return <div className="empty-state"><Palette size={30} /><h3>No active company</h3><p>Company branding requires a company role.</p></div>;
  if (!canAdminister) return <div className="empty-state"><ShieldCheck size={30} /><h3>Administrator access required</h3><p>Only company administrators can change branding and sender-address settings.</p></div>;

  const save = () => update.mutate({
    companyId: activeCompany.id,
    ...form,
    legalName: form.legalName || null,
    email: form.email || null,
    phone: form.phone || null,
    website: form.website || null,
    addressLine1: form.addressLine1 || null,
    addressLine2: form.addressLine2 || null,
    city: form.city || null,
    region: form.region || null,
    postalCode: form.postalCode || null,
    country: form.country || null,
    footerText: form.footerText || null,
    defaultBcc: form.defaultBcc || null,
  });

  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error("Use a PNG or JPEG logo no larger than 5 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result);
      upload.mutate({ companyId: activeCompany.id, base64: value.slice(value.indexOf(",") + 1), mimeType: file.type as "image/png" | "image/jpeg" });
    };
    reader.readAsDataURL(file);
  };

  const company = query.data || activeCompany;
  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Company administration</span><h1>Branding & invoice identity</h1><p>Manage the business identity, sender address, and document styling used on every generated invoice.</p></div>
      <div className="page-heading-actions"><button className="button button-primary" disabled={update.isPending} onClick={save}><Save size={16} />{update.isPending ? "Saving…" : "Save invoice settings"}</button></div>
    </div>
    <div className="two-column">
      <div className="stack">
        <section className="panel">
          <div className="panel-header"><div><h2>Company identity</h2><p>Sender details printed in the invoice header.</p></div></div>
          <div className="panel-body"><div className="form-grid">
            <div className="form-field"><label>Public company name</label><input className="field-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
            <div className="form-field"><label>Legal name</label><input className="field-input" value={form.legalName} onChange={event => setForm({ ...form, legalName: event.target.value })} /></div>
            <div className="form-field"><label>Billing email</label><input className="field-input" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></div>
            <div className="form-field"><label>Phone</label><input className="field-input" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></div>
            <div className="form-field"><label>Website</label><input className="field-input" value={form.website} onChange={event => setForm({ ...form, website: event.target.value })} /></div>
            <div className="form-field"><label>Invoice number prefix</label><input className="field-input" maxLength={24} value={form.invoicePrefix} onChange={event => setForm({ ...form, invoicePrefix: event.target.value.toUpperCase() })} /></div>
          </div></div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>Invoicing company address</h2><p>This secured sender address is printed in the <strong>From</strong> block on invoices generated after you save.</p></div></div>
          <div className="panel-body">
            <div className="form-grid">
              <div className="form-field span-2"><label>Street address</label><input className="field-input" autoComplete="street-address" placeholder="123 Main Street" value={form.addressLine1} onChange={event => setForm({ ...form, addressLine1: event.target.value })} /></div>
              <div className="form-field span-2"><label>Suite, unit, or building</label><input className="field-input" placeholder="Suite 200" value={form.addressLine2} onChange={event => setForm({ ...form, addressLine2: event.target.value })} /></div>
              <div className="form-field"><label>City</label><input className="field-input" autoComplete="address-level2" value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} /></div>
              <div className="form-field"><label>State / province / region</label><input className="field-input" autoComplete="address-level1" value={form.region} onChange={event => setForm({ ...form, region: event.target.value })} /></div>
              <div className="form-field"><label>Postal code</label><input className="field-input" autoComplete="postal-code" value={form.postalCode} onChange={event => setForm({ ...form, postalCode: event.target.value })} /></div>
              <div className="form-field"><label>Country (two-letter code)</label><input className="field-input" autoComplete="country" maxLength={2} placeholder="US" value={form.country} onChange={event => setForm({ ...form, country: event.target.value.toUpperCase() })} /></div>
            </div>
            <div className="invoice-address-preview" aria-live="polite"><div><MapPin size={17} /><span>Invoice From preview</span></div><strong>{form.legalName || form.name || "Your company name"}</strong>{addressLines.length ? <p>{addressLines.map(line => <span key={line}>{line}</span>)}</p> : <p className="address-preview-empty">Enter the business address above to show it on your invoices.</p>}{(form.email || form.phone) && <small>{[form.email, form.phone].filter(Boolean).join(" · ")}</small>}</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>Invoice colors and delivery archive</h2><p>Maintain a consistent document system.</p></div></div>
          <div className="panel-body"><div className="form-grid">
            <div className="form-field"><label>Primary document color</label><input className="field-input" type="color" value={form.primaryColor} onChange={event => setForm({ ...form, primaryColor: event.target.value })} /><small>{form.primaryColor}</small></div>
            <div className="form-field"><label>Total / accent color</label><input className="field-input" type="color" value={form.accentColor} onChange={event => setForm({ ...form, accentColor: event.target.value })} /><small>{form.accentColor}</small></div>
            <div className="form-field span-2"><label>Default BCC archive</label><input className="field-input" type="email" placeholder="archive@your-organization.org" value={form.defaultBcc} onChange={event => setForm({ ...form, defaultBcc: event.target.value })} /><small>When delivery is configured, every sent invoice is copied to this compliant archive address.</small></div>
            <div className="form-field span-2"><label>PDF footer</label><textarea className="field-textarea" value={form.footerText} onChange={event => setForm({ ...form, footerText: event.target.value })} /></div>
          </div></div>
        </section>
      </div>

      <aside className="stack">
        <section className="panel"><div className="panel-header"><div><h2>Company logo</h2><p>PNG or JPEG, maximum 5 MB.</p></div></div><div className="panel-body"><div className="brand-preview"><div className="preview-brand" style={{ justifyContent: form.logoAlignment === "left" ? "space-between" : "flex-end", gap: 15 }}><img src={company.logoKey ? `/manus-storage/${company.logoKey}` : "/brand/welfare-pride-logo.png"} alt="Company logo preview" style={{ maxWidth: `${form.logoScale}%`, maxHeight: 64, objectFit: "contain", order: form.logoAlignment === "right" ? 2 : 0 }} /><span className="preview-title" style={{ order: form.logoAlignment === "right" ? 1 : 0 }}>INVOICE</span></div><span className="brand-preview-note">Live header preview — rendered with proportional contain fitting.</span><div className="dot-pattern" /></div><label className="button button-secondary" style={{ width: "100%", marginTop: 14 }}><ImageUp size={16} />{upload.isPending ? "Uploading logo…" : "Upload replacement logo"}<input type="file" accept="image/png,image/jpeg" onChange={selectLogo} style={{ display: "none" }} /></label><div className="form-field" style={{ marginTop: 18 }}><label>Logo scale — bounded 50% to 160%</label><div className="logo-fit-range"><input type="range" min="50" max="160" value={form.logoScale} onChange={event => setForm({ ...form, logoScale: Number(event.target.value) })} /><input className="field-input" type="number" min="50" max="160" value={form.logoScale} onChange={event => setForm({ ...form, logoScale: Math.min(160, Math.max(50, Number(event.target.value) || 100)) })} /></div><small>The PDF service fits artwork in a bounded box; it never stretches or crops the logo.</small></div><div className="form-field" style={{ marginTop: 14 }}><label>Header alignment</label><select className="field-select" value={form.logoAlignment} onChange={event => setForm({ ...form, logoAlignment: event.target.value as "left" | "right" })}><option value="left">Left aligned logo</option><option value="right">Right aligned logo</option></select></div></div></section>
        <div className="notice notice-info"><ShieldCheck size={17} /><span>Only company administrators can update sender details. Address fields are validated server-side, tenant-scoped, and never read from a PDF request.</span></div>
        <div className="notice notice-warn"><AlertTriangle size={17} /><span>Save the address before generating or sending an invoice. Existing downloaded files remain unchanged, while newly generated PDFs use the saved sender address.</span></div>
      </aside>
    </div>
  </>;
}
