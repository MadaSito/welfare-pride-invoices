import "dotenv/config";
import { bootstrapLocalAdmin, generateTemporaryPassword } from "../server/auth/service";

const password = generateTemporaryPassword();
const result = await bootstrapLocalAdmin(password);
if (result.created) {
  console.log(`BOOTSTRAP_ADMIN_EMAIL=${result.email}`);
  console.log(`BOOTSTRAP_ADMIN_PASSWORD=${password}`);
  console.log("The account must change this password and enroll TOTP MFA on first sign-in.");
} else {
  console.log(`Bootstrap administrator already exists: ${result.email}`);
}
process.exit(0);
