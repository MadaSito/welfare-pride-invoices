import { useAuth } from "@/_core/hooks/useAuth";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { startLogin } from "@/const";
import { cn } from "@/lib/utils";
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
  return (
    <main className="login-stage">
      <section className="login-panel">
        <div className="login-brand"><BrandMark /></div>
        <span className="eyebrow">Secure invoice workspace</span>
        <h1>Every invoice, delivered with care.</h1>
        <p>Build branded PDF invoices, manage delivery securely, and retain a trustworthy audit trail for every send.</p>
        <button className="button button-primary button-wide" onClick={() => startLogin()}>Sign in securely</button>
        <p className="login-caption"><ShieldCheck size={15} /> Your session is validated before any company data is shown.</p>
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
          <select value={activeCompany?.id ?? ""} onChange={event => setActiveCompanyId(Number(event.target.value))} aria-label="Active company">
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
            {allNavigation.some(item => item.href === "/invoices") && <Link href="/invoices/new" className="button button-primary topbar-new"><FilePlus2 size={17} />New invoice</Link>}
          </div>
        </header>
        <main className="content-shell">{children}</main>
      </div>
    </div>
  );
}
