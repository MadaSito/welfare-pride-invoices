import { useAuth } from "@/_core/hooks/useAuth";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  FilePlus2,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Menu,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/recurring-invoices", label: "Recurring", icon: CalendarClock },
  { href: "/clients", label: "Clients", icon: UsersRound },
];
const administration = [
  { href: "/branding", label: "Branding", icon: Building2 },
  { href: "/delivery", label: "Email delivery", icon: Landmark },
  { href: "/email-logs", label: "Email logs", icon: MailCheck },
  { href: "/security", label: "Security & access", icon: ShieldCheck },
];

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return <img src={inverse ? "/brand/welfare-pride-logo-on-dark.png" : "/brand/welfare-pride-logo.png"} alt="Welfare Pride" className="h-10 w-auto object-contain object-left" />;
}

function LoginScreen() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [step, setStep] = useState<"login" | "password_change" | "mfa_setup" | "mfa_verify" | "recovery">("login"); const [code, setCode] = useState(""); const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null); const [recovery, setRecovery] = useState<string[]>([]); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const request = async (url: string, body?: Record<string, string>) => { const response = await fetch(url, { method: body ? "POST" : "GET", credentials: "include", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Authentication failed."); return data; };
  const enroll = async () => { const result = await request("/api/auth/mfa/setup"); setSetup(result); setStep("mfa_setup"); };
  const signIn = async () => { setBusy(true); setMessage(""); try { const result = await request("/api/auth/login", { email, password }); if (result.next === "full") window.location.reload(); else if (result.next === "mfa_setup") await enroll(); else setStep(result.next); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to sign in."); } finally { setBusy(false); } };
  const changePassword = async () => { setBusy(true); setMessage(""); try { await request("/api/auth/change-password", { password }); setStep("mfa_setup"); await enroll(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to change password."); } finally { setBusy(false); } };
  const confirmMfa = async () => { setBusy(true); try { const result = await request("/api/auth/mfa/confirm", { code }); setRecovery(result.recoveryCodes ?? []); setStep("recovery"); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to confirm MFA."); } finally { setBusy(false); } };
  const verifyMfa = async () => { setBusy(true); try { await request("/api/auth/mfa/verify", { code }); window.location.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to verify MFA."); } finally { setBusy(false); } };
  return (
    <main className="login-stage">
      <section className="login-panel">
        <div className="login-brand"><BrandMark /></div>
        <span className="eyebrow">Secure invoice workspace</span>
        <h1>Every invoice, delivered with care.</h1>
        <p>Build branded PDF invoices, manage delivery securely, and retain a trustworthy audit trail for every send.</p>
        {step === "login" && <><label className="form-field"><span>Email</span><input className="field-input" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label><label className="form-field"><span>Password</span><input className="field-input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button button-primary button-wide" disabled={busy} onClick={signIn}>{busy ? "Signing in…" : "Sign in"}</button><a className="button button-secondary button-wide" href="/api/auth/entra/login">Sign in with Welfare Pride Single Sign On (SSO)</a></>}
        {step === "password_change" && <><h2>Set your permanent password</h2><p>Your temporary password must be changed before access is granted.</p><label className="form-field"><span>New password</span><input className="field-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button button-primary button-wide" disabled={busy} onClick={changePassword}>Save password</button></>}
        {step === "mfa_setup" && <><h2>Set up authenticator MFA</h2><p>Add this secret to Microsoft Authenticator, Google Authenticator, or another TOTP app, then enter the six-digit code.</p>{setup ? <><code className="auth-secret">{setup.secret}</code><label className="form-field"><span>Authenticator code</span><input className="field-input" inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} /></label><button className="button button-primary button-wide" disabled={busy} onClick={confirmMfa}>Verify and continue</button></> : <button className="button button-primary button-wide" disabled={busy} onClick={enroll}>{busy ? "Preparing MFA…" : "Prepare authenticator setup"}</button>}</>}
        {step === "mfa_verify" && <><h2>Verify MFA</h2><p>Enter your six-digit authenticator code or an unused recovery code.</p><label className="form-field"><span>Verification code</span><input className="field-input" inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} /></label><button className="button button-primary button-wide" disabled={busy} onClick={verifyMfa}>Verify and continue</button></>}
        {step === "recovery" && <><h2>Save recovery codes</h2><p>Store these one-time codes securely. They are shown only once.</p><code className="auth-secret">{recovery.join("\n")}</code><button className="button button-primary button-wide" onClick={() => window.location.reload()}>I saved my codes</button></>}
        {message && <p className="auth-error">{message}</p>}<p className="login-caption"><ShieldCheck size={15} /> Application-owned sessions and MFA protect every company workspace.</p>
      </section>
      <aside className="login-aside">
        <div className="dot-pattern" />
        <div className="login-aside-copy">
          <span>WELFARE PRIDE</span>
          <strong>Organized billing.<br />Clearer relationships.</strong>
        </div>
      </aside>
    </main>
  );
}

function InitialSetupAssistant() {
  const setup = trpc.setup.status.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils(); const [, setLocation] = useLocation();
  const complete = trpc.setup.completeInitialSetup.useMutation({ onSuccess: () => utils.setup.status.invalidate() });
  if (!setup.data || setup.data.complete) return null;
  return <section className="notice notice-info" style={{ margin: "0 0 20px", alignItems: "flex-start" }}>
    <ShieldCheck size={19} style={{ marginTop: 2, flex: "0 0 auto" }} />
    <div style={{ width: "100%" }}><strong>Initial administrator setup</strong><p style={{ margin: "5px 0 13px" }}>Finish the essential Welfare Pride configuration before inviting staff or issuing invoices. SSO and email delivery are optional, but are prompted here so they can be configured deliberately.</p>
      <div className="inline-actions" style={{ flexWrap: "wrap" }}>
        <button className="button button-secondary" onClick={() => setLocation("/branding")}>Configure branding</button>
        <button className="button button-secondary" onClick={() => setLocation("/security")}>{setup.data.ssoConfigured ? "Review Welfare Pride SSO" : "Configure Welfare Pride SSO"}</button>
        <button className="button button-secondary" onClick={() => setLocation("/delivery")}>Configure Graph or SMTP mail</button>
        <button className="button button-primary" disabled={complete.isPending || !setup.data.encryptionReady} onClick={() => complete.mutate()}>{complete.isPending ? "Completing…" : "Mark initial setup complete"}</button>
      </div>
      {!setup.data.encryptionReady && <small style={{ display: "block", marginTop: 10 }}>The server security key must be configured before setup can be completed.</small>}
    </div>
  </section>;
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <Link href={href} className={cn("nav-link", active && "nav-link-active")}>
      <Icon size={18} strokeWidth={active ? 2.4 : 2} />
      <span>{label}</span>
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const [location] = useLocation();
  const { activeCompany, companies, isPlatformAdmin, setActiveCompanyId } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return <div className="app-loading"><span className="loading-orb" />Loading your secure workspace…</div>;
  if (!user) return <LoginScreen />;

  const isAdministrator = isPlatformAdmin || activeCompany?.memberRole === "platform_admin";
  const allNavigation = isAdministrator ? [...navigation, ...administration] : navigation;
  return (
    <div className="app-frame">
      <aside className={cn("sidebar", menuOpen && "sidebar-open")}>
        <div className="sidebar-brand"><BrandMark inverse /><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
        <div className="company-switcher">
          <Building2 size={16} />
          <select value={activeCompany?.id ?? ""} disabled={!companies.length} onChange={event => setActiveCompanyId(Number(event.target.value))} aria-label="Active company">
            {!companies.length && <option value="">No active companies</option>}
            {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
          <ChevronDown size={15} />
        </div>
        <nav className="sidebar-nav" onClick={() => setMenuOpen(false)}>
          <p className="nav-label">Workspace</p>
          {navigation.map(item => <NavLink key={item.href} {...item} active={location === item.href || (item.href !== "/" && location.startsWith(`${item.href}/`))} />)}
          {isAdministrator && <>
            <p className="nav-label nav-label-admin">Administration</p>
            {administration.map(item => <NavLink key={item.href} {...item} active={location === item.href} />)}
          </>}
        </nav>
        <div className="sidebar-foot">
          <div className="user-card"><span className="avatar">{(user.name || user.email || "U").slice(0, 1).toUpperCase()}</span><span><strong>{user.name || "Account"}</strong><small>{isAdministrator ? "Administrator" : "Invoice viewer"}</small></span></div>
          <button className="nav-link sign-out" onClick={() => logout()}><LogOut size={18} /> <span>Sign out</span></button>
        </div>
      </aside>
      {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div><span className="topbar-context">{activeCompany ? activeCompany.name : "Welfare Pride Invoices"}</span><span className="topbar-status"><span /> Secure workspace</span></div>
          <div className="topbar-actions">
            <button className="icon-button" title="Notifications"><Bell size={18} /></button>
            {activeCompany && allNavigation.some(item => item.href === "/invoices") && <Link href="/invoices/new" className="button button-primary topbar-new"><FilePlus2 size={17} />New invoice</Link>}
          </div>
        </header>
        <main className="content-shell">{user.role === "admin" && <InitialSetupAssistant />}{children}</main>
      </div>
    </div>
  );
}
