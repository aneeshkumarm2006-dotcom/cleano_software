import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import {
  LEGACY_ORG_SLUG,
  ORG_SLUG_HEADER,
  PLATFORM_ORG_SLUG,
  isPlatformPath,
  orgSlugFromHost,
  workspaceOriginFor,
} from '@/lib/tenant'

// Exact public paths
const PUBLIC_EXACT = new Set<string>([
  '/sign-in',
  '/sign-up',
  '/get-started', // a cleaning company creating its own workspace on Awer
  '/get-started/organization', // Organization tier: a request, not a signup
  '/cleanos/login', // cleaner sign-in
  '/applicant-login', // applicant portal sign-in (decision D4)
  '/login', // customer sign-in
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/book',
  '/quote',
  '/gift-card',
  '/careers', // public careers / hiring page
  '/faq', // public FAQ
  '/reviews', // public reviews
  '/join-waitlist', // public waitlist signup
  '/apple-icon', // PWA icon for iOS home screen
  '/workspace-unavailable', // suspended / unknown workspace notice
])

// Public path prefixes (anything under these is public)
const PUBLIC_PREFIXES = [
  '/book/', // includes /book and any nested segments
  '/rate/', // /rate/[token]
  '/add-card/', // /add-card/[token] customer card setup link
  '/applicant-invite/', // /applicant-invite/[token] set-password invite link (decision D4)
  '/p/', // existing landing pages
  '/gift-card/', // gift card purchase + redemption flow
  '/api/auth/', // Better Auth endpoints
  '/api/post-signin', // role-aware redirect endpoint
  '/icon/', // PWA install icons (32/192/512) — Chrome fetches without a session
]

/**
 * The address the browser actually asked for.
 *
 * `new URL(path, request.url)` is the obvious way to build a redirect and it is
 * wrong. Next does not guarantee that the URL a proxy sees carries the public
 * host — in practice it reports the address the connection landed on — so on a
 * tenant subdomain that produced an absolute redirect to a different host. A
 * cleaner opening `teamcleano.useawer.com/cleaners/dashboard` was sent to a
 * sign-in page where their session does not exist, and signing in there did
 * nothing. The identical mistake had already broken sign-in once, in
 * /api/post-signin, which is why org-url.ts derives its origin the same way.
 *
 * A relative Location header would be the tidier fix, but Next rejects one in a
 * proxy response, so the Host header it is.
 */
function selfOrigin(request: NextRequest): string {
  const host = request.headers.get('host')
  if (!host) return request.nextUrl.origin
  // A forwarded-proto header can carry a list; the first hop is the browser's.
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
  const isLocal =
    host.startsWith('localhost') ||
    host.includes('.localhost') ||
    host.startsWith('127.0.0.1')
  return `${forwarded || (isLocal ? 'http' : 'https')}://${host}`
}

/** Redirect to a path on the address the browser asked for. */
function redirectSamePath(request: NextRequest, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, selfOrigin(request)), 307)
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Which organization is this request for? Derived from the host alone, so it
  // costs no database round-trip here. Anything that is not a tenant subdomain
  // (www, the apex, a vercel.app build URL, localhost) resolves to the default
  // org, which is what keeps www.useawer.com behaving exactly as it does today.
  //
  // Stamped on the request rather than resolved to a record here: proxy runs on
  // every request including static-ish ones, and server components can look the
  // organization up once, cached, only when they actually need it.
  const orgSlug = orgSlugFromHost(request.headers.get('host'))
  const headers = new Headers(request.headers)
  headers.set(ORG_SLUG_HEADER, orgSlug)
  // The gate in the root layout needs to know which path is being served, so it
  // can let the "workspace unavailable" page itself through instead of
  // redirecting to it forever.
  headers.set('x-awer-path', pathname)
  // A client must never be able to spoof its way into another tenant by sending
  // this header itself; setting it from the host on every request overwrites
  // anything inbound.
  const next = () => NextResponse.next({ request: { headers } })

  // Awer's front door is not a cleaning company's application.
  //
  // `useawer.com` used to BE TeamCleano, because they were the only company on
  // it. Now that anyone can sign up, a visitor arriving at the bare domain is a
  // prospective customer, and showing them another company's booking form — or
  // worse, an admin panel backed by Awer's own workspace — is not something to
  // leave to chance. So the tenant application is kept off this host entirely.
  //
  // Runs BEFORE the public-route check on purpose: `/book`, `/login` and
  // `/careers` are public, but they are still a particular company's pages.
  if (orgSlug === PLATFORM_ORG_SLUG && !isPlatformPath(pathname)) {
    // Cleaners have this host bookmarked and installed on their phones from
    // before the move. Forward them rather than break them.
    const proto =
      request.headers.get('x-forwarded-proto') ||
      request.nextUrl.protocol.replace(':', '') ||
      'https'
    const legacy = LEGACY_ORG_SLUG
      ? workspaceOriginFor(LEGACY_ORG_SLUG, request.headers.get('host'), proto)
      : null
    if (legacy) {
      // 307, not 308. This redirect is meant to be switched off once those
      // bookmarks have died out, and a browser that cached a permanent one
      // would keep honouring it long after the environment variable was gone.
      return NextResponse.redirect(
        new URL(`${pathname}${request.nextUrl.search}`, legacy),
        307,
      )
    }
    return redirectSamePath(request, '/get-started')
  }

  // Allow public routes (customer-facing + auth pages). "/" is the customer
  // home and is gated by the customer (secured) layout, not here.
  if (isPublic(pathname)) {
    return next()
  }

  // Check for session cookie
  const sessionCookie = getSessionCookie(request.headers)

  // If no session cookie exists, redirect to the login door for that area:
  //   /admin/*     → staff sign-in (/sign-in)
  //   /console/*   → staff sign-in (/sign-in) — Awer's own console
  //   /cleaners/*  → cleaner sign-in (/cleanos/login)
  //   /applicant/* → applicant portal sign-in (/applicant-login), decision D4
  //   everything else (customer area, incl. "/") → customer sign-in (/login)
  if (!sessionCookie) {
    const isAdminArea = pathname.startsWith('/admin')
    // Awer's own console uses the same staff door. It gives away nothing that
    // /sign-in doesn't: whether the account is platform staff is decided after
    // the password, by the console layout, not here.
    const isConsoleArea = pathname.startsWith('/console')
    const isCleanerArea = pathname.startsWith('/cleaners')
    const isApplicantArea = pathname.startsWith('/applicant')
    const target = isAdminArea || isConsoleArea
      ? '/sign-in'
      : isCleanerArea
        ? '/cleanos/login'
        : isApplicantArea
          ? '/applicant-login'
          : '/login'
    // Built as a path, not an absolute URL, so it stays on the company's own
    // address. See redirectSamePath above.
    const params = new URLSearchParams()
    // Preserve the intended destination for redirect after login (staff areas).
    if (isAdminArea || isConsoleArea || isCleanerArea || isApplicantArea) {
      params.set('callbackUrl', pathname)
    }
    const query = params.toString()
    return redirectSamePath(request, query ? `${target}?${query}` : target)
  }

  // Session cookie exists, allow request to proceed
  return next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - files with extensions (e.g., .png, .jpg, .svg)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
