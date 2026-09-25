import { assetUrl, fetchLatestRelease, isPlatform, RELEASES_URL } from '@/lib/release.ts';

export const dynamic = 'force-dynamic';

/**
 * Sends a download button to the build of the latest release, so the page never has to be built
 * again for a new version. Without an answer from GitHub it falls back to the release page.
 */
export async function GET(_request: Request, { params }: { readonly params: Promise<{ platform: string }> }) {
    const { platform } = await params;
    if (!isPlatform(platform)) {
        return new Response('Not found', { status: 404 });
    }
    const release = await fetchLatestRelease();
    const url = release ? assetUrl(release, platform) : null;
    return new Response(null, {
        status: 302,
        headers: { Location: url ?? RELEASES_URL, 'Cache-Control': 'no-store' }
    });
}
