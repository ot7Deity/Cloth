"use client";

import { useActionState } from "react";
import { loginAction, signUpAction } from "@/app/actions";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const action = mode === "login" ? loginAction : signUpAction;
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | undefined, formData: FormData) => {
      return action(formData);
    },
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {mode === "signup" ? (
        <label className="flex flex-col gap-2 text-sm text-zinc-400">
          Username
          <input
            name="username"
            required
            minLength={3}
            maxLength={20}
            className="border border-white/15 bg-transparent px-4 py-3 text-white outline-none focus:border-white/40"
            placeholder="archiveboy"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-2 text-sm text-zinc-400">
        Email
        <input
          name="email"
          type="email"
          required
          className="border border-white/15 bg-transparent px-4 py-3 text-white outline-none focus:border-white/40"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm text-zinc-400">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          className="border border-white/15 bg-transparent px-4 py-3 text-white outline-none focus:border-white/40"
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-red-400">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 border border-white bg-white px-5 py-3 text-sm font-medium tracking-wide text-black uppercase disabled:opacity-50"
      >
        {pending ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}
