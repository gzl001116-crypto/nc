import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/current-user";
import { safeNext } from "@/lib/format";

export const metadata = { title: "登录" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(nextPath);
  return (
    <AuthForm mode="login" nextPath={nextPath} devMailbox={process.env.NODE_ENV !== "production"} />
  );
}
