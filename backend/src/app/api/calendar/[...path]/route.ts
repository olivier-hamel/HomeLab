import { createCalendarApi } from "@/lib/calendar/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createCalendarApi();
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
