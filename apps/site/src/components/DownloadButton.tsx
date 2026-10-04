'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { downloadPlatform } from '@/lib/download-platform';
import { PLATFORMS, type Platform } from '@/lib/release.ts';

interface LatestRelease {
    readonly version: string;
    readonly platforms: readonly Platform[];
}

function subscribe() {
    return () => {};
}

export function DownloadButton() {
    const platform = useSyncExternalStore(
        subscribe,
        () => downloadPlatform(navigator.userAgent),
        () => null
    );
    const [failed, setFailed] = useState(false);
    const [release, setRelease] = useState<LatestRelease | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/release', { signal: controller.signal })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Release unavailable');
                }
                return response.json() as Promise<LatestRelease>;
            })
            .then(setRelease)
            .catch(() => {
                if (!controller.signal.aborted) {
                    setFailed(true);
                }
            });
        return () => controller.abort();
    }, []);

    const available = platform !== null && release?.platforms.includes(platform) === true;
    const build = platform === null ? null : PLATFORMS[platform];
    const detail = build === null ? null : platform === 'mac' ? build.arch : `${build.format}, ${build.arch}`;

    return (
        <div className="flex flex-col items-start gap-3">
            <a
                href={available ? `/download/${platform}` : '#download'}
                className="inline-flex items-center gap-2.5 rounded-full bg-text px-6 py-3.5 text-[15px] font-medium text-bg shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-[background-color,transform] hover:bg-white active:scale-[0.96]"
            >
                <Download size={18} strokeWidth={2.2} />
                {available && build !== null ? `Download for ${build.os}` : 'Choose a download'}
            </a>
            <div className="text-[14px] leading-snug text-text-muted">
                <span>
                    {available
                        ? `Version ${release?.version}, ${detail}`
                        : failed
                          ? 'Could not check the latest builds'
                          : platform !== null && release !== null
                            ? 'This build is not in the latest release'
                            : 'Available for macOS and Linux'}
                </span>
                <span className="mx-2 text-text-faint">/</span>
                <a href="#download" className="text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
                    {available ? 'Other builds' : 'See builds'}
                </a>
            </div>
            {!available && (
                <a href="https://station.ruimte.app" className="text-[14px] text-text underline underline-offset-4">
                    Open the web app
                </a>
            )}
        </div>
    );
}
