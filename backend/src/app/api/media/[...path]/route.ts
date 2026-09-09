import { createMediaApi } from "@/lib/media/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createMediaApi();
export const GET = handle;
export const POST = handle;
export const HEAD = handle;
