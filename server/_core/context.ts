import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest, type AuthSession } from "../auth/service";

export type TrpcContext = { req: CreateExpressContextOptions["req"]; res: CreateExpressContextOptions["res"]; user: User | null; session: AuthSession | null };
export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const session = await authenticateRequest(opts.req).catch(() => null);
  return { req: opts.req, res: opts.res, user: session?.user ?? null, session };
}
