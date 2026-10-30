import { trpc } from "@/lib/trpc";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Download,
  Folder,
  FolderOpen,
  HardDriveUpload,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Provider = "s3" | "sharepoint";
type SharePointLibrary = { id: string; name: string; webUrl: string | null };
type SharePointFolder = { id: string; name: string; webUrl: string | null };

const emptyS3 = { endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "", accessKeyId: "", secretAccessKey: "", prefix: "welfare-pride-invoices-backups" };
const emptySharePoint = { tenantId: "", clientId: "", clientSecret: "", siteUrl: "", siteId: "", driveId: "", folderPath: "Welfare Pride Invoices Backups" };

function FolderBreadcrumbs({ path, onOpen, disabled }: { path: string; onOpen: (path: string) => void; disabled: boolean }) {
  const segments = path.split("/").filter(Boolean);
  return <nav className="sharepoint-breadcrumbs" aria-label="SharePoint folder location">
    <button type="button" className="link-button" disabled={disabled} onClick={() => onOpen("")}>Root</button>
    {segments.map((segment, index) => {
      const ancestor = segments.slice(0, index + 1).join("/");
      return <span key={ancestor}><ChevronRight size={14} /><button type="button" className="link-button" disabled={disabled} onClick={() => onOpen(ancestor)}>{segment}</button></span>;
    })}
  </nav>;
}

export default function Backups() {
  const utils = trpc.useUtils();
  const destinations = trpc.backups.destinations.useQuery();
  const runs = trpc.backups.runs.useQuery();
  const [provider, setProvider] = useState<Provider>("s3");
  const [label, setLabel] = useState("Primary encrypted backup");
  const [editingId, setEditingId] = useState<number | undefined>();
  const [s3, setS3] = useState(emptyS3);
  const [sharePoint, setSharePoint] = useState(emptySharePoint);
  const [libraries, setLibraries] = useState<SharePointLibrary[]>([]);
  const [siteName, setSiteName] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [folders, setFolders] = useState<SharePointFolder[]>([]);
  const [showAdvancedIds, setShowAdvancedIds] = useState(false);
  const details = trpc.backups.destinationDetails.useQuery({ destinationId: editingId ?? 0 }, { enabled: Boolean(editingId) });

  useEffect(() => {
    if (!details.data) return;
    setLabel(details.data.label);
    setEditingId(details.data.id);
    setProvider(details.data.config.provider);
    if (details.data.config.provider === "s3") {
      setS3({ ...emptyS3, ...details.data.config, accessKeyId: "", secretAccessKey: "" });
      return;
    }
    setSharePoint({ ...emptySharePoint, ...details.data.config, clientSecret: "" });
    setBrowsePath(details.data.config.folderPath || "");
    setLibraries([]);
    setFolders([]);
  }, [details.data]);

  const refresh = () => { utils.backups.destinations.invalidate(); utils.backups.runs.invalidate(); };
  const save = trpc.backups.saveDestination.useMutation({
    onSuccess: () => { toast.success("Encrypted backup destination saved."); refresh(); setEditingId(undefined); },
    onError: error => toast.error(error.message),
  });
  const test = trpc.backups.testDestination.useMutation({ onSuccess: data => { toast.success(data.summary); refresh(); }, onError: error => toast.error(error.message) });
  const run = trpc.backups.runCloudBackup.useMutation({ onSuccess: data => { toast.success(`Encrypted backup uploaded: ${data.filename}`); refresh(); }, onError: error => toast.error(error.message) });
  const browse = trpc.backups.browseSharePointFolders.useMutation({
    onSuccess: data => { setBrowsePath(data.folderPath); setFolders(data.folders); },
    onError: error => toast.error(error.message),
  });

  const sharePointCredentials = (overrides: Partial<typeof sharePoint> = {}) => ({
    destinationId: editingId,
    tenantId: overrides.tenantId ?? sharePoint.tenantId,
    clientId: overrides.clientId ?? sharePoint.clientId,
    clientSecret: overrides.clientSecret ?? sharePoint.clientSecret,
  });
  const discover = trpc.backups.discoverSharePoint.useMutation({
    onSuccess: data => {
      const firstLibrary = data.drives[0];
      const next = { ...sharePoint, siteUrl: data.site.webUrl, siteId: data.site.id, driveId: firstLibrary?.id ?? "", folderPath: "" };
      setSharePoint(next);
      setSiteName(data.site.name);
      setLibraries(data.drives);
      setBrowsePath("");
      setFolders([]);
      toast.success(`Found ${data.site.name} and ${data.drives.length} accessible document ${data.drives.length === 1 ? "library" : "libraries"}.`);
      if (firstLibrary) browse.mutate({ ...sharePointCredentials(next), siteId: next.siteId, driveId: firstLibrary.id, folderPath: "" });
    },
    onError: error => toast.error(error.message),
  });

  const openFolder = (folderPath: string, values = sharePoint) => {
    if (!values.siteId || !values.driveId) { toast.error("Find the SharePoint site and select a document library first."); return; }
    browse.mutate({ ...sharePointCredentials(values), siteId: values.siteId, driveId: values.driveId, folderPath });
  };
  const discoverSite = () => discover.mutate({ ...sharePointCredentials(), siteUrl: sharePoint.siteUrl });
  const selectLibrary = (driveId: string) => {
    const next = { ...sharePoint, driveId, folderPath: "" };
    setSharePoint(next);
    setBrowsePath("");
    setFolders([]);
    openFolder("", next);
  };
  const selectCurrentFolder = () => {
    setSharePoint(current => ({ ...current, folderPath: browsePath }));
    toast.success(`Selected ${browsePath ? `/${browsePath}` : "the document library root"} for encrypted backups.`);
  };
  const saveDestination = () => {
    const config = provider === "s3" ? { provider, ...s3 } : { provider, ...sharePoint };
    save.mutate({ id: editingId, label, isActive: true, config });
  };
  const resetForm = () => {
    setEditingId(undefined); setProvider("s3"); setLabel("Primary encrypted backup"); setS3(emptyS3); setSharePoint(emptySharePoint);
    setLibraries([]); setSiteName(""); setBrowsePath(""); setFolders([]); setShowAdvancedIds(false);
  };
  const canBrowse = Boolean(sharePoint.siteId && sharePoint.driveId);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Recovery operations</span><h1>Backups & exports</h1><p>Download a credential-free data export or upload an encrypted archive to S3-compatible storage or a Microsoft SharePoint document library.</p></div><div className="page-heading-actions"><a className="button button-secondary" href="/api/admin/backups/export"><Download size={16} />Download local export</a></div></div>
    <div className="notice notice-info" style={{ marginBottom: 18 }}><ShieldCheck size={17} /><span><strong>Recovery boundary:</strong> local exports exclude credentials, password hashes, MFA data, recovery codes, and sessions. Cloud archives are AES-GCM encrypted before upload; retain your server security key separately from the archive.</span></div>
    <div className="invoice-layout"><div className="stack"><section className="panel"><div className="panel-header"><div><h2>{editingId ? "Reconfigure encrypted destination" : "Add encrypted cloud destination"}</h2><p>Use AWS S3, Wasabi, Backblaze B2 S3-compatible storage, or select a SharePoint document library and folder. Existing secrets may be left blank when updating an existing destination.</p></div>{editingId && <button className="button button-secondary" onClick={resetForm}>New destination</button>}</div><div className="panel-body"><div className="form-grid"><div className="form-field span-2"><label>Destination label</label><input className="field-input" value={label} onChange={event => setLabel(event.target.value)} /></div></div><div style={{ display: "flex", gap: 10, margin: "16px 0", flexWrap: "wrap" }}><button className={`button ${provider === "s3" ? "button-primary" : "button-secondary"}`} onClick={() => setProvider("s3")}><Cloud size={16} />S3-compatible</button><button className={`button ${provider === "sharepoint" ? "button-primary" : "button-secondary"}`} onClick={() => setProvider("sharepoint")}><HardDriveUpload size={16} />Microsoft SharePoint</button></div>
      {provider === "s3" ? <div className="form-grid"><div className="form-field"><label>HTTPS endpoint</label><input className="field-input" placeholder="https://s3.amazonaws.com" value={s3.endpoint} onChange={event => setS3({ ...s3, endpoint: event.target.value })} /></div><div className="form-field"><label>Region</label><input className="field-input" value={s3.region} onChange={event => setS3({ ...s3, region: event.target.value })} /></div><div className="form-field"><label>Bucket</label><input className="field-input" value={s3.bucket} onChange={event => setS3({ ...s3, bucket: event.target.value })} /></div><div className="form-field"><label>Prefix</label><input className="field-input" value={s3.prefix} onChange={event => setS3({ ...s3, prefix: event.target.value })} /></div><div className="form-field"><label>Access key ID</label><input className="field-input" autoComplete="off" value={s3.accessKeyId} onChange={event => setS3({ ...s3, accessKeyId: event.target.value })} /></div><div className="form-field"><label>Secret access key</label><input className="field-input" type="password" autoComplete="new-password" value={s3.secretAccessKey} onChange={event => setS3({ ...s3, secretAccessKey: event.target.value })} /></div></div> : <div className="stack"><div className="notice notice-info"><FolderOpen size={17} /><span><strong>Simple SharePoint setup:</strong> enter the Entra application credentials and a normal site web address. The application will find the site, document libraries, and folders for you. The Graph app needs access to the selected site and library.</span></div><div className="form-grid"><div className="form-field"><label>Microsoft Entra tenant ID</label><input className="field-input" value={sharePoint.tenantId} onChange={event => setSharePoint({ ...sharePoint, tenantId: event.target.value })} /></div><div className="form-field"><label>Application client ID</label><input className="field-input" value={sharePoint.clientId} onChange={event => setSharePoint({ ...sharePoint, clientId: event.target.value })} /></div><div className="form-field span-2"><label>Application client secret</label><input className="field-input" type="password" autoComplete="new-password" placeholder={editingId ? "Leave blank to retain the saved secret" : "Required to discover a new site"} value={sharePoint.clientSecret} onChange={event => setSharePoint({ ...sharePoint, clientSecret: event.target.value })} /></div><div className="form-field span-2"><label>SharePoint site address</label><div className="inline-field-action"><input className="field-input" placeholder="https://contoso.sharepoint.com/sites/Finance" value={sharePoint.siteUrl} onChange={event => setSharePoint({ ...sharePoint, siteUrl: event.target.value })} /><button type="button" className="button button-secondary" disabled={discover.isPending} onClick={discoverSite}><Search size={16} />{discover.isPending ? "Finding…" : "Find site & libraries"}</button></div><small>Paste the site address from your browser. Raw Graph identifiers are resolved automatically.</small></div></div>
        {libraries.length > 0 && <div className="sharepoint-picker"><div className="sharepoint-picker-header"><div><strong>{siteName || "Resolved SharePoint site"}</strong><small>{sharePoint.siteUrl}</small></div><span className="status status-sent">Site found</span></div><div className="form-field"><label>Document library</label><select className="field-select" value={sharePoint.driveId} onChange={event => selectLibrary(event.target.value)}>{libraries.map(library => <option value={library.id} key={library.id}>{library.name}</option>)}</select></div><div className="sharepoint-folder-panel"><div className="sharepoint-folder-panel-header"><div><strong>Select a folder</strong><FolderBreadcrumbs path={browsePath} onOpen={openFolder} disabled={browse.isPending || !canBrowse} /></div><button type="button" className="button button-primary" disabled={browse.isPending || !canBrowse} onClick={selectCurrentFolder}>Use this folder</button></div>{browse.isPending ? <p className="muted">Loading folders…</p> : <div className="sharepoint-folder-grid">{browsePath && <button type="button" className="sharepoint-folder-button sharepoint-folder-up" onClick={() => openFolder(browsePath.split("/").slice(0, -1).join("/"))}><ArrowLeft size={17} />Up one folder</button>}{folders.map(folder => <button type="button" key={folder.id} className="sharepoint-folder-button" onClick={() => openFolder([...browsePath.split("/").filter(Boolean), folder.name].join("/"))}><Folder size={18} /><span>{folder.name}</span><ChevronRight size={16} /></button>)}{!folders.length && <p className="muted">This folder has no subfolders. You can select it for backups.</p>}</div>}<p className="sharepoint-selected-path"><strong>Selected backup folder:</strong> {sharePoint.folderPath ? `/${sharePoint.folderPath}` : "Document library root"}</p></div></div>}
        <button type="button" className="link-button" onClick={() => setShowAdvancedIds(value => !value)}>{showAdvancedIds ? "Hide resolved identifiers" : "Show advanced identifiers"}</button>{showAdvancedIds && <div className="form-grid sharepoint-advanced"><div className="form-field"><label>Resolved SharePoint site ID</label><input className="field-input" value={sharePoint.siteId} onChange={event => setSharePoint({ ...sharePoint, siteId: event.target.value })} /></div><div className="form-field"><label>Resolved document library drive ID</label><input className="field-input" value={sharePoint.driveId} onChange={event => setSharePoint({ ...sharePoint, driveId: event.target.value })} /></div><div className="form-field span-2"><label>Folder path</label><input className="field-input" value={sharePoint.folderPath} onChange={event => { const folderPath = event.target.value; setSharePoint({ ...sharePoint, folderPath }); setBrowsePath(folderPath); }} /></div></div>}</div>}
      <div className="form-footer"><button className="button button-primary" disabled={save.isPending} onClick={saveDestination}><Archive size={16} />{save.isPending ? "Saving…" : "Save encrypted destination"}</button></div></div></section></div><aside className="stack"><section className="panel"><div className="panel-header"><div><h2>Cloud destinations</h2><p>Credentials are never displayed after saving.</p></div></div><div className="panel-body">{destinations.data?.length ? <div className="stack">{destinations.data.map(destination => <div key={destination.id} className="subpanel"><strong>{destination.label}</strong><small>{destination.provider === "s3" ? "S3-compatible" : "Microsoft SharePoint"}{destination.lastVerifiedAt ? ` · verified ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(destination.lastVerifiedAt)}` : " · not yet verified"}</small><div className="inline-actions"><button className="link-button" onClick={() => setEditingId(destination.id)}>Configure</button><button className="link-button" disabled={test.isPending} onClick={() => test.mutate({ destinationId: destination.id })}>Test</button><button className="link-button" disabled={run.isPending} onClick={() => { if (window.confirm("Create and upload an encrypted backup archive now?")) run.mutate({ destinationId: destination.id }); }}>Run backup</button></div></div>)}</div> : <p className="muted">No cloud destination has been saved.</p>}</div></section><div className="notice notice-success"><CheckCircle2 size={17} /><span>For full recovery, retain your GitHub source, MySQL provider backups, the application encryption key, and at least one independent encrypted data archive.</span></div></aside></div>
    <section className="panel" style={{ marginTop: 20 }}><div className="panel-header"><div><h2>Backup run history</h2><p>Latest local exports, connection tests, and encrypted cloud uploads.</p></div></div><div className="table-scroll">{runs.data?.length ? <table className="data-table"><thead><tr><th>Started</th><th>Operation</th><th>Destination</th><th>Status</th><th>Archive / summary</th></tr></thead><tbody>{runs.data.map(item => <tr key={item.id}><td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt)}</td><td>{item.operation.replace(/_/g, " ")}</td><td>{item.destinationLabel || "Local download"}</td><td><span className={`status status-${item.status}`}>{item.status}</span></td><td>{item.archiveLocation || item.summary || "Preparing…"}</td></tr>)}</tbody></table> : <div className="empty-state"><Upload size={28} /><h3>No backup activity yet</h3><p>Run a local export, test a destination, or upload an encrypted cloud archive.</p></div>}</div></section>
  </>;
}
