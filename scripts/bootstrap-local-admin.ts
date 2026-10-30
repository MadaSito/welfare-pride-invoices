import "dotenv/config";
import { bootstrapLocalAdmin, generateTemporaryPassword } from "../server/auth/service";

const suppliedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
if (suppliedPassword && suppliedPassword.length < 14) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters.");

const password = suppliedPassword || generateTemporaryPassword();
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || "admin@welfarepride.local";
const result = await bootstrapLocalAdmin(password, email);

if (result.created) {
  console.log(`BOOTSTRAP_ADMIN_EMAIL=${result.email}`);
  if (suppliedPassword) console.log("Bootstrap administrator created with BOOTSTRAP_ADMIN_PASSWORD. Remove that environment variable after confirming first sign-in.");
  else console.log(`BOOTSTRAP_ADMIN_PASSWORD=${password}`);
  console.log("The account must change this password and enroll TOTP MFA on first sign-in.");
} else {
  console.log(`Bootstrap administrator already exists: ${result.email}`);
}
process.exit(0);
