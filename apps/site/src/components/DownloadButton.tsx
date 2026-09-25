'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { PLATFORMS, type Platform } from '@/lib/release.ts';

interface LatestRelease {
    readonly version: string;
    readonly platforms: readonly Platform[];
}

const subscribe = () => () => {};

function detectPlatform(): Platform {
    const agent = navigator.userAgent;
    if (!/Linux/.test(agent) || /Android/.test(agent)) {
        return 'mac';
    }
    return /aarch64|arm64/i.test(agent) ? 'appimage-arm64' : 'appimage-x64';
}

/**
 * The download for the platform this page runs on. It renders for macOS on the server and switches
 * to Linux once the browser says it is one; anything else gets the Mac build and a way to the rest.
 */
export function DownloadButton() {
    const platform = useSyncExternalStore(subscribe, detectPlatform, () => 'mac' as const);
    const [release, setRelease] = useState<LatestRelease | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/release', { signal: controller.signal })
            .then((response) => (response.ok ? (response.json() as Promise<LatestRelease>) : null))
            .then(setRelease)
            .catch(() => {});
        return () => controller.abort();
    }, []);

    const { os, arch, format } = PLATFORMS[platform];
    const detail = platform === 'mac' ? arch : `${format}, ${arch}`;

    return (
        <div className="flex flex-col items-start gap-3">
            <a
                href={`/download/${platform}`}
                className="inline-flex items-center gap-2.5 rounded-full bg-text px-6 py-3.5 text-[15px] font-medium text-bg shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-[background-color,transform] hover:bg-white active:scale-[0.96]"
            >
                <Download size={18} strokeWidth={2.2} />
                Download for {os}
            </a>
            <div className="text-[14px] leading-snug text-text-muted">
                <span>{release ? `Version ${release.version}, ${detail}` : detail}</span>
                <span className="mx-2 text-text-faint">/</span>
                <a href="#download" className="text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
                    {platform === 'mac' ? 'Linux and other builds' : 'Other builds'}
                </a>
            </div>
        </div>
    );
}
