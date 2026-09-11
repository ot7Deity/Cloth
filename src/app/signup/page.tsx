import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Header } from "@/components/header";

export default function SignupPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-medium">Create account</h1>
        <p className="mt-2 mb-8 text-sm text-zinc-400">
          Already have one?{" "}
          <Link href="/login" className="text-white underline">
            Log in
          </Link>
        </p>
        <AuthForm mode="signup" />
      </main>
    </div>
  );
}
