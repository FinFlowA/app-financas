import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SecurityPanel from "./security-panel";

export default async function SegurancaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const metadata = user.user_metadata as Record<string, unknown>;
  const phone = user.phone || (typeof metadata.telefone === "string" ? metadata.telefone : null);
  return <SecurityPanel currentEmail={user.email} currentPhone={phone} />;
}
