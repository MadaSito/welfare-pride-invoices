import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; options: Record<string, unknown> };
function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];
  const ctx = { user: null, session: null, req: { protocol: "https", headers: {} }, res: { clearCookie: (name: string, options: Record<string, unknown>) => clearedCookies.push({ name, options }) } } as unknown as TrpcContext;
  return { ctx, clearedCookies };
}
describe("auth.logout", () => {
  it("clears standalone session and CSRF cookies and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext(); const result = await appRouter.createCaller(ctx).auth.logout();
    expect(result).toEqual({ success: true }); expect(clearedCookies.map(item => item.name)).toEqual([COOKIE_NAME, "wp_invoice_csrf"]);
    expect(clearedCookies[0]?.options).toMatchObject({ httpOnly: true, path: "/" }); expect(clearedCookies[1]?.options).toMatchObject({ httpOnly: false, path: "/" });
  });
});
