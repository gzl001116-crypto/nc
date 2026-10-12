import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/current-user";
import { safeNext } from "@/lib/format";

export const metadata = { title: "注册" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(nextPath);
  return (
    <AuthForm mode="register" nextPath={nextPath} devMailbox={process.env.NODE_ENV !== "production"} />
  );
}
