import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { ORG_SLUG_HEADER, orgSlugFromHost } from '@/lib/tenant'

// Exact public paths
const PUBLIC_EXACT = new Set<string>([
  '/sign-in',
  '/sign-up',
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
    const signInUrl = new URL(target, request.url)
    // Preserve the intended destination for redirect after login (staff areas).
    if (isAdminArea || isConsoleArea || isCleanerArea || isApplicantArea) {
      signInUrl.searchParams.set('callbackUrl', pathname)
    }
    return NextResponse.redirect(signInUrl)
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
