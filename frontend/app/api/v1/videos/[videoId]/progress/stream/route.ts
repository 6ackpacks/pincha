import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const backendUrl = `${BACKEND_URL}/api/v1/videos/${videoId}/progress/stream`;

  const backendRes = await fetch(backendUrl, {
    headers: {
      "x-active-kb": req.headers.get("x-active-kb") || "",
    },
  });

  if (!backendRes.ok || !backendRes.body) {
    return new Response(backendRes.statusText, { status: backendRes.status });
  }

  return new Response(backendRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
