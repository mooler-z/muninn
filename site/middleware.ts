/**
 * Everything under /admin needs a session.
 *
 * In middleware rather than in each page, so a new admin route is protected by
 * existing rather than by remembering to add a guard. The login page and its
 * API are the two exceptions, and they are excluded by the matcher rather than
 * by an `if` — a matcher cannot be forgotten halfway down a function.
 */

import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, valid } from "./lib/auth";

export async function middleware(request: NextRequest) {
  if (await valid(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const login = new URL("/admin/login", request.url);
  // So the visitor lands where they were headed rather than on the dashboard.
  if (request.nextUrl.pathname !== "/admin") {
    login.searchParams.set("next", request.nextUrl.pathname);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin", "/admin/((?!login).*)"],
};
