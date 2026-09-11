import { NextRequest, NextResponse } from "next/server";
import { pollAllShops } from "@/lib/poll";

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  const header = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  const ok =
    expected &&
    (secret === expected || header === `Bearer ${expected}`);

  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pollAllShops();
  return NextResponse.json({ ok: true, ...result });
}
