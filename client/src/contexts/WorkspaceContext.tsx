import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type WorkspaceValue = {
  loading: boolean;
  error: unknown | null;
  companies: Array<any>;
  activeCompany: any | null;
  metrics: any | null;
  isPlatformAdmin: boolean;
  setActiveCompanyId: (id: number) => void;
  refresh: () => Promise<unknown>;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const ACTIVE_COMPANY_KEY = "welfare-pride-active-company";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const query = trpc.workspace.overview.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(() => {
    const saved = localStorage.getItem(ACTIVE_COMPANY_KEY);
    return saved ? Number(saved) : null;
  });

  const companies = query.data?.companies ?? [];
  useEffect(() => {
    if (!companies.length) return;
    if (!activeCompanyId || !companies.some(company => company.id === activeCompanyId)) {
      setActiveCompanyId(companies[0].id);
    }
  }, [activeCompanyId, companies]);
  useEffect(() => {
    if (activeCompanyId) localStorage.setItem(ACTIVE_COMPANY_KEY, String(activeCompanyId));
  }, [activeCompanyId]);

  const value = useMemo<WorkspaceValue>(() => ({
    loading: Boolean(user) && query.isLoading,
    error: query.error ?? null,
    companies,
    activeCompany: companies.find(company => company.id === activeCompanyId) ?? companies[0] ?? null,
    metrics: query.data?.metrics ?? null,
    isPlatformAdmin: query.data?.isPlatformAdmin ?? false,
    setActiveCompanyId,
    refresh: query.refetch,
  }), [activeCompanyId, companies, query.data?.isPlatformAdmin, query.data?.metrics, query.error, query.isLoading, query.refetch, user]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
