import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest, NextResponse } from "next/server";

const session = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: session.updateSession }));

import { config, middleware } from "@/middleware";

function request(headers: Record<string, string> = {}, path = "/api/dashboard"): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.updateSession.mockResolvedValue(NextResponse.next());
});

describe("the middleware's Bearer fast path", () => {
  it("does no cookie session work at all for a token request", async () => {
    // Refreshing a cookie session a native client does not have, and cannot
    // be redirected to a login page, is pure latency on every API call.
    const response = await middleware(request({ authorization: "Bearer some.jwt.value" }));

    expect(session.updateSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("skips regardless of the scheme's casing or spacing", async () => {
    for (const header of ["bearer x.y.z", "BEARER   x.y.z", "Bearer\tx.y.z"]) {
      await middleware(request({ authorization: header }));
    }

    expect(session.updateSession).not.toHaveBeenCalled();
  });

  it("still runs the full cookie path when there is no token", async () => {
    await middleware(request());
    await middleware(request({ cookie: "sb-project-auth-token=abc" }));

    expect(session.updateSession).toHaveBeenCalledTimes(2);
  });

  it("does not treat a non-Bearer Authorization header as a token", async () => {
    // Basic auth, or a stray header, must not switch off web session handling.
    await middleware(request({ authorization: "Basic dXNlcjpwYXNz" }));

    expect(session.updateSession).toHaveBeenCalledTimes(1);
  });

  it("leaves the matcher's existing exclusions alone", async () => {
    const matcher = config.matcher[0];

    for (const excluded of ["api/health", "api/webhooks", "api/cron", "_next/static"]) {
      expect(matcher).toContain(excluded);
    }
  });
});
