# Microsoft Clarity integration

Microsoft Clarity is optional and disabled until a platform administrator enables it in **Security & access → Microsoft Clarity analytics**.

## Configure

1. Create or open a Microsoft Clarity project and copy its **project ID**.
2. Sign in as a Welfare Pride platform administrator.
3. Open **Security & access** and select **Microsoft Clarity analytics**.
4. Enable the integration, paste the project ID, then save.
5. Refresh an open browser page. The official `@microsoft/clarity` browser package initializes once with the configured project ID.

The project ID is validated and stored in encrypted application settings. Only an enabled project ID is returned to the browser, because Clarity requires it to initialize its client script. No administrator role, credentials, session, invoice, client, or mail configuration is exposed by this configuration endpoint.

## Privacy and governance

Enabling Clarity sends interaction telemetry to Microsoft Clarity. Before enabling it, the administrator is responsible for applying the organization’s privacy notice, consent policy, data-processing review, accessibility requirements, and any regional/legal obligations. Do not place sensitive customer, payment, authentication, medical, or financial information in client-side labels or custom analytics tags.

Disable the integration in **Security & access** to stop future browser initialization. Open pages that already loaded the tracker receive a consent withdrawal signal; users should refresh or navigate again to apply the disabled configuration consistently. Each configuration change is recorded in the application audit log.
