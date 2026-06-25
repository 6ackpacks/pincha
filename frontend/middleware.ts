import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/landing", "/share-card-preview"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("session");

  // Pass through public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // Redirect logged-in users away from login page (but not landing)
    if (session && pathname.startsWith("/login")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Unauthenticated users hitting "/" go to landing page
  if (!session) {
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/landing", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Admin routes: session cookie is already required above.
  // Admin permission (is_admin) is checked client-side in the admin layout
  // because Next.js Edge middleware cannot make async calls to the backend.

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|capi/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm)$).*)"],
};
