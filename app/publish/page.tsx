import { redirect } from "next/navigation";
import { PublishForm } from "@/components/publish-form";
import { getCurrentUser } from "@/lib/current-user";

export const metadata = { title: "投稿" };

export default async function PublishPage() {
  if (!(await getCurrentUser())) redirect("/login?next=/publish");
  return <PublishForm />;
}
