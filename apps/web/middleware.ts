import { type NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const countries = (process.env.BLOCKED_COUNTRIES ?? '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
  if (!countries.length) return NextResponse.next();
  const country = process.env.VERCEL === '1' ? request.headers.get('x-vercel-ip-country')?.toUpperCase() : undefined;
  if (!country || countries.includes(country)) return new NextResponse('Service unavailable in this region', { status: 451 });
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
