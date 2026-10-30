import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSharePointSite, listSharePointFolders, testBackupDestination } from "./services/backups";

const credentials = { tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "test-only-secret" };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function token(url: string) {
  return url.includes("oauth2/v2.0/token");
}

function sampleSiteDrives() {
  return { value: [{ id: "documents-drive", name: "Documents", driveType: "documentLibrary", webUrl: "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents" }] };
}

afterEach(() => vi.unstubAllGlobals());

describe("SharePoint backup discovery", () => {
  it("resolves encoded browser-copied site URLs once and collects paged document libraries", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const target = String(url); calls.push(target);
      if (token(target)) return json({ access_token: "graph-token" });
      if (target.includes("/sites/contoso.sharepoint.com:/sites/Project%20Alpha%20%26%20R%C3%A9sum%C3%A9")) return json({ id: "site-guid", displayName: "Project Alpha & Résumé", webUrl: "https://contoso.sharepoint.com/sites/Project%20Alpha%20%26%20R%C3%A9sum%C3%A9" });
      if (target.includes("/sites/site-guid/drives") && target.includes("skiptoken=second")) return json({ value: [{ id: "assets-drive", name: "Assets", driveType: "documentLibrary" }] });
      if (target.includes("/sites/site-guid/drives")) return json({ value: [{ id: "documents-drive", name: "Documents", driveType: "documentLibrary" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site-guid/drives?$skiptoken=second" });
      return new Response(null, { status: 404 });
    }));

    const result = await discoverSharePointSite({ ...credentials, siteUrl: "https://contoso.sharepoint.com/sites/Project%20Alpha%20%26%20R%C3%A9sum%C3%A9" });
    expect(result.site.name).toBe("Project Alpha & Résumé");
    expect(result.drives.map(drive => drive.name)).toEqual(["Documents", "Assets"]);
    expect(calls.some(call => call.includes("%2520") || call.includes("%2526") || call.includes("%25C3"))).toBe(false);
  });

  it("lists paged folders through a selected drive that belongs to the selected site", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (token(target)) return json({ access_token: "graph-token" });
      if (target.includes("/sites/site-guid/drives")) return json(sampleSiteDrives());
      if (target.includes("/root:/Finance/2026:/children") && target.includes("skiptoken=second")) return json({ value: [{ id: "folder-2", name: "Archive", folder: {} }] });
      if (target.includes("/root:/Finance/2026:/children")) return json({ value: [{ id: "folder-1", name: "Backups", folder: {}, webUrl: "https://contoso.sharepoint.com/backups" }, { id: "file-1", name: "readme.txt", file: {} }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/drives/documents-drive/root:/Finance/2026:/children?$skiptoken=second" });
      if (target.includes("/root:/Finance/2026")) return json({ id: "folder-current", name: "2026", folder: {} });
      return new Response(null, { status: 404 });
    }));

    const result = await listSharePointFolders({ ...credentials, siteId: "site-guid", driveId: "documents-drive", folderPath: "/Finance/2026/" });
    expect(result.folderPath).toBe("Finance/2026");
    expect(result.folders.map(folder => folder.name)).toEqual(["Backups", "Archive"]);
  });

  it("rejects a drive that is accessible but does not belong to the selected SharePoint site", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => token(String(url)) ? json({ access_token: "graph-token" }) : json({ value: [{ id: "different-drive", name: "Documents", driveType: "documentLibrary" }] })));
    await expect(listSharePointFolders({ ...credentials, siteId: "site-guid", driveId: "documents-drive", folderPath: "" })).rejects.toThrow(/does not belong/);
  });

  it("rejects a missing or file-backed backup path instead of claiming the destination is ready", async () => {
    const missing = vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (token(target)) return json({ access_token: "graph-token" });
      if (target.includes("/sites/site-guid/drives")) return json(sampleSiteDrives());
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", missing);
    await expect(testBackupDestination({ provider: "sharepoint", ...credentials, siteId: "site-guid", driveId: "documents-drive", folderPath: "Missing" })).rejects.toThrow(/request failed/);

    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (token(target)) return json({ access_token: "graph-token" });
      if (target.includes("/sites/site-guid/drives")) return json(sampleSiteDrives());
      return json({ id: "file-1", name: "not-a-folder.txt", file: {} });
    }));
    await expect(testBackupDestination({ provider: "sharepoint", ...credentials, siteId: "site-guid", driveId: "documents-drive", folderPath: "not-a-folder.txt" })).rejects.toThrow(/not an accessible folder/);
  });

  it("rejects non-SharePoint or insecure site addresses and unsafe Graph continuation URLs", async () => {
    await expect(discoverSharePointSite({ ...credentials, siteUrl: "http://localhost/sites/Finance" })).rejects.toThrow(/SharePoint site/);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (token(target)) return json({ access_token: "graph-token" });
      if (target.includes("/sites/contoso.sharepoint.com:/sites/Finance")) return json({ id: "site-guid", displayName: "Finance" });
      return json({ value: [], "@odata.nextLink": "https://attacker.example/continuation" });
    }));
    await expect(discoverSharePointSite({ ...credentials, siteUrl: "https://contoso.sharepoint.com/sites/Finance" })).rejects.toThrow(/unsafe pagination/);
  });
});
