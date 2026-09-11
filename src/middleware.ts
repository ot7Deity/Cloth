import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = Boolean(req.auth);
  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron");

  if (!isLoggedIn && !isPublic) {
    const login = new URL("/login", req.nextUrl.origin);
    return Response.redirect(login);
  }

  if (isLoggedIn && (pathname === "/login" || pathname === "/signup")) {
    return Response.redirect(new URL("/", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
