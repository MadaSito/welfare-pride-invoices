import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppShell from "@/components/AppShell";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import Branding from "@/pages/Branding";
import ClientDirectory from "@/pages/ClientDirectory";
import Delivery from "@/pages/Delivery";
import EmailLogs from "@/pages/EmailLogs";
import Home from "@/pages/Home";
import InvoiceEditor from "@/pages/InvoiceEditor";
import Invoices from "@/pages/Invoices";
import RecurringInvoices from "@/pages/RecurringInvoices";
import NotFound from "@/pages/NotFound";
import Security from "@/pages/Security";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/new" component={InvoiceEditor} />
        <Route path="/invoices/:invoiceId/edit" component={InvoiceEditor} />
        <Route path="/recurring-invoices" component={RecurringInvoices} />
        <Route path="/clients" component={ClientDirectory} />
        <Route path="/branding" component={Branding} />
        <Route path="/delivery" component={Delivery} />
        <Route path="/email-logs" component={EmailLogs} />
        <Route path="/security" component={Security} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <WorkspaceProvider>
            <Router />
          </WorkspaceProvider>
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
