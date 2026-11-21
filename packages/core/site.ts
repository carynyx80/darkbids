export const PUBLIC_SITE_ORIGIN = "https://www.primar.site";
export const LEGACY_SITE_HOST = "darkbid-web.vercel.app";

// Keep the established signing message and derivation salt on the new site.
export function vaultIdentityHost(host: string) {
	return host === new URL(PUBLIC_SITE_ORIGIN).host ? LEGACY_SITE_HOST : host;
}
