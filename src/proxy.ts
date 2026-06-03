import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// Exact public paths
const PUBLIC_EXACT = new Set<string>([
  '/sign-in',
  '/sign-up',
  '/portal/login',
  '/portal/setup',
  '/book',
  '/quote',
  '/gift-card',
  '/apple-icon', // PWA icon for iOS home screen
])

// Public path prefixes (anything under these is public)
const PUBLIC_PREFIXES = [
  '/book/', // includes /book and any nested segments
  '/rate/', // /rate/[token]
  '/add-card/', // /add-card/[token] customer card setup link
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

  // If trying to access "/" route, always redirect to "/sign-in"
  if (pathname === '/') {
    const redirectToSignInUrl = new URL('/sign-in', request.url)
    return NextResponse.redirect(redirectToSignInUrl)
  }

  // Allow public routes (customer-facing + auth pages)
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  // Check for session cookie
  const sessionCookie = getSessionCookie(request.headers)

  // If no session cookie exists, redirect to the appropriate sign-in.
  // Customer area → /portal/login; everything else → /sign-in.
  if (!sessionCookie) {
    const isCustomerArea = pathname.startsWith('/portal')
    const target = isCustomerArea ? '/portal/login' : '/sign-in'
    const signInUrl = new URL(target, request.url)
    // Preserve the intended destination for redirect after login
    if (!isCustomerArea) {
      signInUrl.searchParams.set('callbackUrl', pathname)
    }
    return NextResponse.redirect(signInUrl)
  }

  // Session cookie exists, allow request to proceed
  return NextResponse.next()
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
