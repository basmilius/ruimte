import { availablePlatforms, fetchLatestRelease, isPlatform, PLATFORMS, RELEASES_URL } from '@/lib/release';

export const dynamic = 'force-dynamic';

export default async function Downloads({ searchParams }: { searchParams: Promise<{ platform?: string; reason?: string }> }) {
    const params = await searchParams;
    const release = await fetchLatestRelease();
    const platforms = release === null ? [] : availablePlatforms(release);
    const build = params.platform !== undefined && isPlatform(params.platform) ? PLATFORMS[params.platform] : null;
    return (
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
            <a href="/" className="text-text-muted hover:text-text">
                Ruimte
            </a>
            <h1 className="font-display text-4xl font-semibold text-text">Download Ruimte</h1>
            <p className="text-text-muted">
                {params.reason === 'unavailable' && build !== null
                    ? `The ${build.os} ${build.format} for ${build.arch} is not in the latest release. Choose another build below.`
                    : release === null
                      ? 'The latest release could not be checked. Try again or see the releases on GitHub.'
                      : `Available builds for version ${release.version}.`}
            </p>
            <ul className="flex flex-col gap-2">
                {platforms.map((platform) => (
                    <li key={platform}>
                        <a
                            className="flex min-h-11 items-center rounded-lg border border-border px-4 py-3 text-text hover:bg-surface-hover"
                            href={`/download/${platform}`}
                        >
                            {PLATFORMS[platform].os} · {PLATFORMS[platform].format} · {PLATFORMS[platform].arch}
                        </a>
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap gap-4 text-text underline underline-offset-4">
                <a href="/download">Check again</a>
                <a href={RELEASES_URL}>GitHub releases</a>
                <a href="https://station.ruimte.app">Open the web app</a>
            </div>
        </main>
    );
}
