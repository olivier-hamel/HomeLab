import { createLibraryApi } from "@/lib/library/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createLibraryApi();
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
