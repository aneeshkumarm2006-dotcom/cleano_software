// Who is acting, as a service sees it (API_V1.md §5).
//
// A service takes an Actor and plain input. It never reads headers or cookies
// and never redirects, so the web's server actions and the v1 handlers can
// both call it: each front door does its own authentication and hands over
// the result.
import "server-only";

export interface Actor {
  userId: string;
  organizationId: string;
  role: string;
  name: string | null;
  email: string;
}

/** The session fields a web action already has, as an Actor. */
export function actorFromSession(
  user: { id: string; name?: string | null; email: string; role?: string | null },
  organizationId = "",
): Actor {
  return {
    userId: user.id,
    organizationId,
    role: user.role ?? "",
    name: user.name ?? null,
    email: user.email,
  };
}
