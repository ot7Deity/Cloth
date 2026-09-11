import Link from "next/link";
import { signOutAction } from "@/app/actions";

type HeaderProps = {
  username?: string | null;
};

export function Header({ username }: HeaderProps) {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="text-sm font-medium tracking-[0.35em] uppercase">
          Cloth
        </Link>
        {username ? (
          <nav className="flex items-center gap-5 text-sm text-zinc-400">
            <Link href="/" className="hover:text-white">
              Feed
            </Link>
            <Link href="/shops" className="hover:text-white">
              Shops
            </Link>
            <span className="text-zinc-500">@{username}</span>
            <form action={signOutAction}>
              <button type="submit" className="hover:text-white">
                Sign out
              </button>
            </form>
          </nav>
        ) : (
          <nav className="flex items-center gap-5 text-sm text-zinc-400">
            <Link href="/login" className="hover:text-white">
              Log in
            </Link>
            <Link href="/signup" className="hover:text-white">
              Sign up
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
