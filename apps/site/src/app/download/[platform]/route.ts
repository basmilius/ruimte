import { assetUrl, fetchLatestRelease, isPlatform } from '@/lib/release.ts';

export const dynamic = 'force-dynamic';

/**
 * Sends a download button to the build of the latest release, so the page never has to be built
 * again for a new version. A missing build opens the download choices with an explanation.
 */
export async function GET(request: Request, { params }: { readonly params: Promise<{ platform: string }> }) {
    const { platform } = await params;
    if (!isPlatform(platform)) {
        return new Response('Not found', { status: 404 });
    }
    const release = await fetchLatestRelease();
    const url = release ? assetUrl(release, platform) : null;
    return new Response(null, {
        status: 302,
        headers: {
            Location: url ?? new URL(`/download?platform=${platform}&reason=${release === null ? 'lookup-failed' : 'unavailable'}`, request.url).toString(),
            'Cache-Control': 'no-store'
        }
    });
}
