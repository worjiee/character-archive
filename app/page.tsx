import { redirect } from "next/navigation";
import { requireOwnerPageSession } from "@/src/lib/auth";

export default async function Home() {
  await requireOwnerPageSession();
  redirect("/characters");
}
