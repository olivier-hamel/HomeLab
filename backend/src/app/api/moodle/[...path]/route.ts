import { createMoodleApi } from "@/lib/moodle/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createMoodleApi();
export const GET = handle;
export const POST = handle;
