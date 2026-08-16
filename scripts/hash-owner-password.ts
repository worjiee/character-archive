import "dotenv/config";
import { generateOwnerPasswordHash } from "../src/lib/auth/password";

async function main(): Promise<void> {
  const password = process.env.OWNER_PASSWORD_INPUT;
  if (!password) {
    console.error("Set OWNER_PASSWORD_INPUT temporarily before running this command. See docs/DEVELOPMENT.md.");
    process.exitCode = 1;
    return;
  }

  console.log(await generateOwnerPasswordHash(password));
}

void main();
