import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Not logged in → redirect to login
  if (!user && !pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Logged in → redirect away from login
  if (user && pathname === '/login') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role
    if (role === 'Admin') return NextResponse.redirect(new URL('/admin', request.url))
    if (role === 'CEO')   return NextResponse.redirect(new URL('/ceo', request.url))
    return NextResponse.redirect(new URL('/trainer', request.url))
  }

  // Role-based path protection
  if (user && (pathname.startsWith('/admin') || pathname.startsWith('/ceo') || pathname.startsWith('/trainer'))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role

    if (pathname.startsWith('/admin') && role !== 'Admin') {
      return NextResponse.redirect(new URL(role === 'CEO' ? '/ceo' : '/trainer', request.url))
    }
    if (pathname.startsWith('/ceo') && role !== 'CEO' && role !== 'Admin') {
      return NextResponse.redirect(new URL('/trainer', request.url))
    }
    if (pathname.startsWith('/trainer') && role === 'CEO') {
      return NextResponse.redirect(new URL('/ceo', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
