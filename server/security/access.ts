import { TRPCError } from "@trpc/server";
import type { CompanyMemberRole, User } from "../../drizzle/schema";
import { getCompanyAccess } from "../db";

const ROLE_WEIGHT: Record<CompanyMemberRole, number> = {
  company_viewer: 1,
  company_creator: 2,
  platform_admin: 3,
};

export async function requireCompanyRole(user: User | null, companyId: number, minimumRole: CompanyMemberRole = "company_viewer") {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in is required." });
  const role = await getCompanyAccess(user, companyId);
  if (!role || ROLE_WEIGHT[role] < ROLE_WEIGHT[minimumRole]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this company resource." });
  }
  return role;
}

export function requirePlatformAdmin(user: User | null) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in is required." });
  if (user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Platform administrator access is required." });
  return user;
}
