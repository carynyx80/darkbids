import { LEGACY_SITE_HOST, PUBLIC_SITE_ORIGIN } from "@veil/core/site";
import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
	if (request.headers.get("host") === LEGACY_SITE_HOST) {
		const destination = new URL(PUBLIC_SITE_ORIGIN);
		destination.pathname = request.nextUrl.pathname;
		destination.search = request.nextUrl.search;
		return NextResponse.redirect(destination, 307);
	}

	const countries = (process.env.BLOCKED_COUNTRIES ?? "")
		.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean);
	if (!countries.length) return NextResponse.next();
	const country =
		process.env.VERCEL === "1"
			? request.headers.get("x-vercel-ip-country")?.toUpperCase()
			: undefined;
	if (!country || countries.includes(country))
		return new NextResponse("Service unavailable in this region", {
			status: 451,
		});
	return NextResponse.next();
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
