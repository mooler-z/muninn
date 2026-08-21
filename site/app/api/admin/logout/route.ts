import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.redirect(new URL("/admin/login", request.url), 303);
}
