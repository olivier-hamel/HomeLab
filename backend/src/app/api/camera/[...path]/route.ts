import { createCameraApi } from "@/lib/camera/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createCameraApi();
export const GET = handle;
export const POST = handle;
