import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();
function csrfToken() { return document.cookie.split(";").map(item => item.trim()).find(item => item.startsWith("wp_invoice_csrf="))?.slice("wp_invoice_csrf=".length) ?? ""; }
const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, headers: () => ({ "x-wp-csrf-token": csrfToken() }), fetch(input, init) { return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" }); } })] });
createRoot(document.getElementById("root")!).render(<trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></trpc.Provider>);
