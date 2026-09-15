"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth, signIn, signOut } from "@/auth";
import { normalizeShopUrl } from "@/lib/catalog";
import { importShop } from "@/lib/poll";
import { prisma } from "@/lib/prisma";
import { claimShopForScan } from "@/lib/shop-claim";

function usernameOk(username: string) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email." };
  }
  if (!usernameOk(username)) {
    return {
      error: "Username must be 3–20 letters, numbers, or underscores.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const taken = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username: username.toLowerCase() }],
    },
  });
  if (taken) {
    return { error: "Email or username is already taken." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      username: username.toLowerCase(),
      passwordHash,
    },
  });

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created, but sign-in failed. Try logging in." };
    }
    throw error;
  }
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function addShopAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in." };
  }

  const rawUrl = String(formData.get("url") ?? "").trim();
  if (!rawUrl) {
    return { error: "Paste a shop URL." };
  }

  let url: URL;
  try {
    url = normalizeShopUrl(rawUrl);
  } catch {
    return { error: "That does not look like a valid URL." };
  }

  const host = url.hostname.toLowerCase();
  const { shop, needsScan } = await claimShopForScan(host, url.toString());

  await prisma.watch.upsert({
    where: {
      userId_shopId: { userId: session.user.id, shopId: shop.id },
    },
    create: { userId: session.user.id, shopId: shop.id },
    update: {},
  });

  if (needsScan) {
    after(() => importShop(shop.id));
  }

  revalidatePath("/");
  revalidatePath("/shops");

  return {
    ok: true as const,
    shopId: shop.id,
    host,
    name: shop.name,
    status: needsScan ? ("scanning" as const) : (shop.status as "scanning" | "active" | "unsupported"),
  };
}

export async function unwatchAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;

  const shopId = String(formData.get("shopId") ?? "");
  await prisma.watch.deleteMany({
    where: { userId: session.user.id, shopId },
  });
  revalidatePath("/");
  revalidatePath("/shops");
}

/**
 * Thin wrapper so a plain <form action={...}> (no useActionState, return
 * value unused) can trigger a rescan without a type mismatch against
 * addShopAction's discriminated-union return value.
 */
export async function retryShopAction(formData: FormData): Promise<void> {
  await addShopAction(formData);
}
