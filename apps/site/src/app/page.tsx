import type { ReactNode } from 'react';
import { AppIcon } from '@/components/AppIcon.tsx';
import { Backdrop } from '@/components/Backdrop.tsx';
import { DownloadButton } from '@/components/DownloadButton.tsx';
import { ComputerUseVignette } from '@/components/features/ComputerUseVignette.tsx';
import { DrawingVignette } from '@/components/features/DrawingVignette.tsx';
import { MachinesVignette } from '@/components/features/MachinesVignette.tsx';
import { SessionsVignette } from '@/components/features/SessionsVignette.tsx';
import { Film } from '@/components/film/Film.tsx';
import { HeroVisual } from '@/components/hero/HeroVisual.tsx';
import { HeroVisualMenu } from '@/components/hero/HeroVisualMenu.tsx';
import { HeroVisualProvider } from '@/components/hero/HeroVisualProvider.tsx';
import { ContextVignette } from '@/components/features/ContextVignette.tsx';
import { PlanVignette } from '@/components/features/PlanVignette.tsx';
import { TeamVignette } from '@/components/features/TeamVignette.tsx';
import { QuestionVignette } from '@/components/features/QuestionVignette.tsx';
import { ArrowUpRight } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { PLATFORMS, type Platform, REPOSITORY_URL } from '@/lib/release.ts';

const STATION_URL = 'https://station.ruimte.app';

const LINUX_BUILDS: readonly (readonly [Platform, Platform])[] = [
    ['appimage-x64', 'appimage-arm64'],
    ['deb-x64', 'deb-arm64'],
    ['rpm-x64', 'rpm-arm64']
];

export default function Home() {
    return (
        <HeroVisualProvider>
            <a href="#content" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-lg bg-text px-4 py-3 text-bg focus:translate-y-0">
                Skip to content
            </a>
            <SiteHeader>
                <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-5 sm:px-8">
                    <a href="#top" className="flex items-center gap-2.5">
                        <AppIcon size={30} />
                        <span className="font-brand text-[19px] font-semibold tracking-[-0.01em]">Ruimte</span>
                    </a>
                    <nav aria-label="Site" className="ml-auto flex items-center gap-3 text-[14px] sm:gap-6">
                        <a href="#features" className="hidden min-h-11 items-center text-text-muted transition-colors hover:text-text md:inline-flex">
                            Features
                        </a>
                        <a href={STATION_URL} className="hidden min-h-11 items-center text-text-muted transition-colors hover:text-text sm:inline-flex">
                            Web app
                        </a>
                        <a href={REPOSITORY_URL} className="hidden min-h-11 items-center text-text-muted transition-colors hover:text-text md:inline-flex">
                            GitHub
                        </a>
                        <HeroVisualMenu />
                        <a
                            href="#download"
                            className="inline-flex min-h-10 items-center rounded-full border border-border-strong px-3.5 py-1.5 font-medium transition-colors hover:bg-surface-hover"
                        >
                            Download
                        </a>
                    </nav>
                </div>
            </SiteHeader>

            <main id="top">
                <section id="content" className="relative isolate overflow-hidden">
                    <Backdrop />
                    <div className="mx-auto max-w-[1240px] px-5 pb-24 sm:px-8">
                        <div className="grid items-center gap-2 pt-32 sm:pt-36 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-8 lg:pt-40 lg:pb-12">
                            <div className="relative z-10">
                                <a
                                    href={`${REPOSITORY_URL}/releases`}
                                    className="group mb-7 inline-flex min-h-10 items-center gap-3 text-[13px] text-text-muted transition-colors hover:text-text"
                                >
                                    <span className="h-px w-6 bg-accent" />
                                    <span>Ruimte is in early preview</span>
                                    <ArrowUpRight
                                        size={14}
                                        strokeWidth={1.5}
                                        className="text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
                                    />
                                </a>
                                <h1 className="font-display text-[clamp(42px,7vw,76px)] leading-[1.04] font-semibold tracking-[-0.045em]">
                                    Space for
                                    <br />
                                    <span className="font-bold text-text">AI Engineering.</span>
                                </h1>
                                <p className="mt-6 max-w-[43ch] text-[17px] leading-relaxed text-text-muted sm:text-[19px]">
                                    Your agents, terminals and browsers. One workspace. Connect their context, follow the work, and pick up where you left off.
                                </p>
                                <div className="mt-8 flex flex-wrap items-start gap-x-6 gap-y-4">
                                    <DownloadButton />
                                </div>
                            </div>
                            <HeroVisual />
                        </div>
                        <div id="preview" className="relative z-10 mt-6 lg:mt-12">
                            <Film />
                        </div>
                        <p className="mt-6 text-[14px] text-text-muted">Chats run Claude Code and Codex. Any other CLI runs in a terminal.</p>
                    </div>
                </section>

                <section id="features" className="mx-auto max-w-[1240px] px-5 pt-12 pb-24 sm:px-8 sm:pb-32">
                    <div className="mb-12 max-w-[620px]">
                        <p className="mb-4 text-[14px] font-medium text-text-muted">Context, connected</p>
                        <h2 className="font-display text-[34px] leading-[1.1] font-medium tracking-[-0.035em] sm:text-[46px]">
                            Less repeating yourself.
                            <br />
                            More building together.
                        </h2>
                        <p className="mt-5 text-[17px] leading-relaxed text-text-muted">
                            Put the brief next to the work. Give an agent the context it needs, then follow its progress without digging through a conversation.
                        </p>
                    </div>
                    <div className="grid gap-6 lg:grid-cols-2">
                        <PreviewCard title="Draw a line. Share the context." picture={<ContextVignette />}>
                            Link a note, terminal or another chat to an agent. It can read the sources you connected when it needs them.
                        </PreviewCard>
                        <PreviewCard title="A plan you can follow." picture={<PlanVignette />}>
                            Open the agent's plan beside the chat. See the current step, check the results and leave a note where it matters.
                        </PreviewCard>
                    </div>
                </section>

                <div className="mx-auto max-w-[1240px] space-y-24 border-t border-border px-5 py-24 sm:space-y-32 sm:px-8 sm:py-32">
                    <Feature title="Give the task to a team" eyebrow="Agent teams" picture={<TeamVignette />}>
                        Ask an agent to investigate a slow checkout. It can send request tracing and query analysis to other agents, then read their results and
                        bring you one answer.
                    </Feature>
                    <Feature title="Keep the decisions that matter" eyebrow="Questions and answers" picture={<QuestionVignette />} flip>
                        Your agent can build saved carts, but how long should they last? Answer its question right on the canvas, or write your own answer. It
                        continues with your choice.
                    </Feature>
                    <Feature title="Close the window, keep the work" eyebrow="Persistent sessions" picture={<SessionsVignette />}>
                        Terminals and agents run on your machine, not in the window. Quit Ruimte halfway through a test run, open it tomorrow, and the terminal
                        is where you left it, scrollback included.
                    </Feature>
                    <Feature title="Every machine, and your phone" eyebrow="Connected machines" picture={<MachinesVignette />} flip>
                        Pair another computer once and its projects open as if they were local. Answer an agent from your iPhone, or open any of your machines
                        at{' '}
                        <a href={STATION_URL} className="text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
                            station.ruimte.app
                        </a>
                        .
                    </Feature>
                    <Feature title="Sketch it, and the agent reads it" eyebrow="Visual context" picture={<DrawingVignette />}>
                        Draw boxes and arrows next to your code. Link the drawing to a chat and the agent reads what you drew, in the order you meant it.
                    </Feature>
                    <Feature title="Let an agent use an app" eyebrow="Computer use" picture={<ComputerUseVignette />} flip>
                        Give an agent a Mac app to work in and it gets a cursor of its own, so yours stays free. You decide which apps it may use. Press ⌥Space
                        to pause it and take over.
                    </Feature>
                </div>

                <section id="download" className="relative isolate overflow-hidden border-t border-border">
                    <div
                        aria-hidden
                        className="absolute -top-40 left-1/2 -z-10 size-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(21_93_252/0.08),transparent_60%)] blur-3xl"
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
        </HeroVisualProvider>
    );
}

function Feature({
    title,
    eyebrow,
    picture,
    flip = false,
    children
}: {
    readonly title: string;
    readonly eyebrow: string;
    readonly picture: ReactNode;
    readonly flip?: boolean;
    readonly children: ReactNode;
}) {
    return (
        <section
            className={`grid items-center gap-10 lg:gap-16 ${flip ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]' : 'lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'}`}
        >
            <div className={flip ? 'lg:order-2' : ''}>
                <p className="mb-4 text-[14px] font-medium text-text-muted">{eyebrow}</p>
                <h2 className="font-display text-[34px] leading-[1.1] font-medium tracking-[-0.035em] text-balance sm:text-[46px]">{title}</h2>
                <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-text-muted sm:text-[18px]">{children}</p>
            </div>
            <div className="relative min-w-0">{picture}</div>
        </section>
    );
}

function PreviewCard({ title, picture, children }: { readonly title: string; readonly picture: ReactNode; readonly children: ReactNode }) {
    return (
        <article className="min-w-0">
            <div className="relative">{picture}</div>
            <div className="px-5 pt-6 sm:px-6">
                <h3 className="font-display text-[23px] font-medium tracking-[-0.025em]">{title}</h3>
                <p className="mt-3 max-w-[48ch] text-[16px] leading-relaxed text-text-muted">{children}</p>
            </div>
        </article>
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
            className={`inline-flex min-h-11 items-center rounded-full px-4 py-1.5 text-[15px] font-medium transition-colors ${primary ? 'bg-text text-bg hover:bg-white' : 'border border-border-strong hover:bg-surface-hover'}`}
        >
            {label ?? PLATFORMS[platform].arch}
        </a>
    );
}
