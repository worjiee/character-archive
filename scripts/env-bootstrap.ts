import "dotenv/config";

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("localhost")) {
  process.env.DATABASE_URL =
    process.env.PREVIEW_DATABASE_URL ||
    "postgresql://postgres.ofdkiwwggzojofbxpxfr:chikpeas%40%23.@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true";
}
