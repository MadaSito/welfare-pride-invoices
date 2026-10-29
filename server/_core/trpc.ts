import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { requireCsrf } from "../auth/service";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;
const requireUser = t.middleware(async ({ ctx, type, next }) => {
  if (!ctx.user || !ctx.session || ctx.session.stage !== "full") throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (type === "mutation") {
    try { await requireCsrf(ctx.req, ctx.session); }
    catch { throw new TRPCError({ code: "FORBIDDEN", message: "This request could not be verified. Refresh and try again." }); }
  }
  return next({ ctx: { ...ctx, user: ctx.user, session: ctx.session } });
});
export const protectedProcedure = t.procedure.use(requireUser);
export const adminProcedure = t.procedure.use(t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.session || ctx.session.stage !== "full" || ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  return next({ ctx: { ...ctx, user: ctx.user, session: ctx.session } });
}));
