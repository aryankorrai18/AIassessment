import { randomBytes } from "node:crypto";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { adminUsersCol } from "../src/lib/collections";
import { hashSecret } from "../src/lib/hash";

// Creates the first MASTER_ADMIN. The password is random and printed ONCE —
// there is no way to recover it later, and no hardcoded default.
async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  const existing = await adminUsersCol().where("email", "==", email).limit(1).get();
  if (!existing.empty) {
    console.log(`An admin account for ${email} already exists — nothing to do.`);
    return;
  }

  const password = randomBytes(12).toString("base64url");
  await adminUsersCol().add({
    email,
    name: "Master Admin",
    passwordHash: await hashSecret(password),
    role: "MASTER_ADMIN",
    createdBy: null,
    isActive: true,
    refreshTokenHash: null,
    createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
  });

  console.log("\nSeed MASTER_ADMIN created. Save this password now — it will not be shown again.\n");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}\n`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
