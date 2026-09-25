import type { ReactNode } from 'react';
import { AppIcon } from '@/components/AppIcon.tsx';
import { Backdrop } from '@/components/Backdrop.tsx';
import { DownloadButton } from '@/components/DownloadButton.tsx';
import { ComputerUseVignette } from '@/components/features/ComputerUseVignette.tsx';
import { DrawingVignette } from '@/components/features/DrawingVignette.tsx';
import { MachinesVignette } from '@/components/features/MachinesVignette.tsx';
import { SessionsVignette } from '@/components/features/SessionsVignette.tsx';
import { Film } from '@/components/film/Film.tsx';
import { Orbit } from '@/components/Orbit.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { PLATFORMS, type Platform, REPOSITORY_URL } from '@/lib/release.ts';

const STATION_URL = 'https://station.ruimte.app';

const LINUX_BUILDS: readonly (readonly [Platform, Platform])[] = [
    ['appimage-x64', 'appimage-arm64'],
    ['deb-x64', 'deb-arm64'],
    ['rpm-x64', 'rpm-arm64']
];

/** The glow behind a feature's picture takes the status color the feature is about. */
const GLOW = {
    running: 'rgb(96 165 250 / 0.3)',
    'needs-you': 'rgb(251 191 36 / 0.22)',
    idle: 'rgb(74 222 128 / 0.2)',
    accent: 'rgb(21 93 252 / 0.4)',
    violet: 'rgb(139 92 246 / 0.3)'
} as const;

export default function Home() {
    return (
        <>
            <SiteHeader>
                <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-5 sm:px-8">
                    <a href="#top" className="flex items-center gap-2.5">
                        <AppIcon size={30} />
                        <span className="font-brand text-[19px] font-semibold tracking-[-0.01em]">Ruimte</span>
                    </a>
                    <nav aria-label="Site" className="ml-auto flex items-center gap-6 text-[15px]">
                        <a href={STATION_URL} className="hidden text-text-muted transition-colors hover:text-text sm:inline">
                            Web app
                        </a>
                        <a href={REPOSITORY_URL} className="text-text-muted transition-colors hover:text-text">
                            GitHub
                        </a>
                        <a
                            href="#download"
                            className="rounded-full border border-border-strong px-3.5 py-1.5 font-medium transition-colors hover:bg-surface-hover"
                        >
                            Download
                        </a>
                    </nav>
                </div>
            </SiteHeader>

            <main id="top">
                <section className="relative isolate overflow-hidden">
                    <Backdrop />
                    <div className="mx-auto max-w-[1240px] px-5 pb-24 sm:px-8">
                        <div className="grid items-center gap-6 pt-36 sm:pt-40 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-0 lg:pt-24">
                            <div className="relative z-10">
                                <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface-raised/60 py-1 pr-3 pl-2.5 text-[13px] font-medium text-text-muted backdrop-blur">
                                    <span className="status-pulse size-2 rounded-full bg-status-running" />
                                    Early preview
                                </span>
                                <h1 className="font-display text-[52px] leading-[0.98] font-semibold tracking-[-0.045em] sm:text-[80px]">
                                    Space for <span className="whitespace-nowrap">AI Engineering.</span>
                                </h1>
                                <p className="mt-7 max-w-[46ch] text-[18px] leading-relaxed text-text-muted sm:text-[20px]">
                                    Terminals, coding agents and browsers side by side on one canvas. Ruimte shows you which agent is waiting on you, and every
                                    session keeps running when you close the window.
                                </p>
                                <div className="mt-10">
                                    <DownloadButton />
                                </div>
                            </div>
                            <Orbit className="mx-auto w-full max-w-[420px] lg:-mr-16 lg:max-w-[640px]" />
                        </div>
                        <div className="relative mt-16 lg:mt-8">
                            <div
                                aria-hidden
                                className="absolute inset-x-[8%] top-[6%] -z-10 h-[70%] rounded-full bg-[radial-gradient(closest-side,rgb(21_93_252/0.3),transparent)] blur-3xl"
                            />
                            <Film />
                        </div>
                        <p className="mt-6 text-[15px] text-text-faint">Chats run Claude Code and Codex. Any other CLI runs in a terminal.</p>
                    </div>
                </section>

                <div className="mx-auto max-w-[1240px] space-y-32 px-5 py-24 sm:space-y-44 sm:px-8 sm:py-32">
                    <Feature title="Close the window, keep the work" glow="running" picture={<SessionsVignette />}>
                        Terminals and agents run on your machine, not in the window. Quit Ruimte halfway through a test run, open it tomorrow, and the terminal
                        is where you left it, scrollback included.
                    </Feature>
                    <Feature title="Every machine, and your phone" glow="needs-you" picture={<MachinesVignette />} flip>
                        Pair another computer once and its projects open as if they were local. Answer an agent from your iPhone, or open any of your machines
                        at{' '}
                        <a href={STATION_URL} className="text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
                            station.ruimte.app
                        </a>
                        .
                    </Feature>
                    <Feature title="Sketch it, and the agent reads it" glow="violet" picture={<DrawingVignette />}>
                        Draw boxes and arrows next to your code. Link the drawing to a chat and the agent reads what you drew, in the order you meant it.
                    </Feature>
                    <Feature title="Let an agent use an app" glow="accent" picture={<ComputerUseVignette />} flip>
                        Give an agent a Mac app to work in and it gets a cursor of its own, so yours stays free. You decide which apps it may use. Press ⌥Space
                        to pause it and take over.
                    </Feature>
                </div>

                <section id="download" className="relative isolate overflow-hidden border-t border-border">
                    <div
                        aria-hidden
                        className="absolute -top-40 left-1/2 -z-10 size-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(21_93_252/0.18),transparent_60%)] blur-3xl"
                    />
                    <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                        <div>
                            <h2 className="font-display text-[40px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[56px]">Download Ruimte</h2>
                            <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-text-muted">
                                Every download is the latest release. The Mac app is signed and notarized, and it updates itself. Windows comes later.
                            </p>
                            <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-text-muted">
                                On a server without a screen,{' '}
                                <code className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[15px] text-text">npx ruimte</code> starts a machine
                                you reach from the app or from the web.
                            </p>
                        </div>
                        <div className="space-y-8">
                            <DownloadGroup title="macOS">
                                <li className="flex items-center gap-4 px-4 py-3">
                                    <span className="flex-1">
                                        {PLATFORMS.mac.format} <span className="text-text-muted">for {PLATFORMS.mac.arch}</span>
                                    </span>
                                    <DownloadLink platform="mac" label="Download" primary />
                                </li>
                            </DownloadGroup>
                            <DownloadGroup title="Linux">
                                {LINUX_BUILDS.map(([x64, arm64]) => (
                                    <li key={x64} className="flex items-center gap-4 px-4 py-3">
                                        <span className="flex-1">{PLATFORMS[x64].format}</span>
                                        <DownloadLink platform={x64} />
                                        <DownloadLink platform={arm64} />
                                    </li>
                                ))}
                            </DownloadGroup>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="border-t border-border">
                <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-10 text-[15px] text-text-muted sm:px-8">
                    <AppIcon size={22} />
                    <span>
                        Made by{' '}
                        <a href="https://bas.dev" className="text-text hover:underline">
                            Bas Milius
                        </a>
                        . Ruimte is Dutch for space, and room.
                    </span>
                    <span className="ml-auto flex gap-6">
                        <a href={REPOSITORY_URL} className="hover:text-text">
                            Source
                        </a>
                        <a href={`${REPOSITORY_URL}/blob/main/LICENSE`} className="hover:text-text">
                            License
                        </a>
                        <a href={`${REPOSITORY_URL}/releases`} className="hover:text-text">
                            Releases
                        </a>
                    </span>
                </div>
            </footer>
        </>
    );
}

function Feature({
    title,
    glow,
    picture,
    flip = false,
    children
}: {
    readonly title: string;
    readonly glow: keyof typeof GLOW;
    readonly picture: ReactNode;
    readonly flip?: boolean;
    readonly children: ReactNode;
}) {
    return (
        <section
            className={`grid items-center gap-10 lg:gap-16 ${flip ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]' : 'lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'}`}
        >
            <div className={flip ? 'lg:order-2' : ''}>
                <h2 className="font-display text-[34px] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-[46px]">{title}</h2>
                <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-text-muted sm:text-[18px]">{children}</p>
            </div>
            <div className="relative">
                <div
                    aria-hidden
                    className="absolute -inset-10 -z-10 rounded-full blur-3xl"
                    style={{ background: `radial-gradient(closest-side, ${GLOW[glow]}, transparent)` }}
                />
                {picture}
            </div>
        </section>
    );
}

function DownloadGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <div>
            <h3 className="mb-3 text-[15px] font-medium text-text-muted">{title}</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-[16px]">{children}</ul>
        </div>
    );
}

function DownloadLink({ platform, label, primary = false }: { readonly platform: Platform; readonly label?: string; readonly primary?: boolean }) {
    return (
        <a
            href={`/download/${platform}`}
            className={`rounded-lg px-3 py-1.5 text-[15px] font-medium transition-colors ${primary ? 'bg-text text-bg hover:bg-white' : 'border border-border-strong hover:bg-surface-hover'}`}
        >
            {label ?? PLATFORMS[platform].arch}
        </a>
    );
}
