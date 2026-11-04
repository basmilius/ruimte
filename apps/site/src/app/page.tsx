import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Backdrop } from '@/components/Backdrop.tsx';
import { DownloadButton } from '@/components/DownloadButton.tsx';
import { ComputerUseVignette } from '@/components/features/ComputerUseVignette.tsx';
import { ContextVignette } from '@/components/features/ContextVignette.tsx';
import { DrawingVignette } from '@/components/features/DrawingVignette.tsx';
import { MachinesVignette } from '@/components/features/MachinesVignette.tsx';
import { PlanVignette } from '@/components/features/PlanVignette.tsx';
import { QuestionVignette } from '@/components/features/QuestionVignette.tsx';
import { SessionsVignette } from '@/components/features/SessionsVignette.tsx';
import { TeamVignette } from '@/components/features/TeamVignette.tsx';
import { Film } from '@/components/film/Film.tsx';
import { HeroVisual } from '@/components/hero/HeroVisual.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { PLATFORMS, type Platform, REPOSITORY_URL, STATION_URL } from '@/lib/release.ts';

const LINUX_BUILDS: readonly (readonly [Platform, Platform])[] = [
    ['appimage-x64', 'appimage-arm64'],
    ['deb-x64', 'deb-arm64'],
    ['rpm-x64', 'rpm-arm64']
];

export default function Home() {
    return (
        <>
            <a href="#content" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-lg bg-text px-4 py-3 text-bg focus:translate-y-0">
                Skip to content
            </a>
            <SiteHeader />

            <main>
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
                                    Your agents, terminals and browsers in one workspace. Connect their context and pick up where you left off.
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
                            Say it once.
                            <br />
                            Build together.
                        </h2>
                        <p className="mt-5 text-[17px] leading-relaxed text-text-muted">
                            Put the brief next to the work, and follow an agent without digging through its chat.
                        </p>
                    </div>
                    <div className="grid gap-6 lg:grid-cols-2">
                        <PreviewCard title="Draw a line. Share the context." picture={<ContextVignette />}>
                            Link a note, terminal or chat to an agent, and it reads them when it needs to.
                        </PreviewCard>
                        <PreviewCard title="A plan you can follow." picture={<PlanVignette />}>
                            Open the agent's plan beside the chat. See the current step and leave notes on it.
                        </PreviewCard>
                    </div>
                </section>

                <div className="mx-auto max-w-[1240px] space-y-24 border-t border-border px-5 py-24 sm:space-y-32 sm:px-8 sm:py-32">
                    <Feature title="Give the task to a team" eyebrow="Agent teams" picture={<TeamVignette />}>
                        Ask an agent why checkout is slow. It hands request tracing and query analysis to other agents and brings you one answer.
                    </Feature>
                    <Feature title="Keep the decisions that matter" eyebrow="Questions and answers" picture={<QuestionVignette />} flip>
                        How long should saved carts last? Answer the agent's question on the canvas, or write your own, and it carries on.
                    </Feature>
                    <Feature title="Close the window, keep the work" eyebrow="Persistent sessions" picture={<SessionsVignette />}>
                        Terminals and agents run on your machine, not in the window. Quit halfway through a test run, and tomorrow the terminal is where you
                        left it, scrollback included.
                    </Feature>
                    <Feature title="Every machine, and your phone" eyebrow="Connected machines" picture={<MachinesVignette />} flip>
                        Sign in on another computer and its projects open as if they were local. Answer an agent from your iPhone, or open any machine at{' '}
                        <a href={STATION_URL} className="text-text underline decoration-border-strong underline-offset-4 hover:decoration-text">
                            station.ruimte.app
                        </a>
                        .
                    </Feature>
                    <Feature title="Sketch it, and the agent reads it" eyebrow="Visual context" picture={<DrawingVignette />}>
                        Draw boxes and arrows next to your code. Link the drawing to a chat and the agent reads it in the order you meant.
                    </Feature>
                    <Feature title="Let an agent use an app" eyebrow="Computer use" picture={<ComputerUseVignette />} flip>
                        Give an agent a Mac app and it gets a cursor of its own, so yours stays free. You pick the apps it may use, and ⌥Space pauses it so you
                        can take over.
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
                                Every download is the latest release, and the app updates itself. The Mac app is signed and notarized. The Windows app is not
                                signed yet, so Windows warns the first time.
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
                            <DownloadGroup title="Windows">
                                <li className="flex items-center gap-4 px-4 py-3">
                                    <span className="flex-1">
                                        {PLATFORMS.windows.format} <span className="text-text-muted">for {PLATFORMS.windows.arch}</span>
                                    </span>
                                    <DownloadLink platform="windows" label="Download" />
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

            <SiteFooter />
        </>
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
                <h2 className="font-display text-[34px] leading-[1.1] font-medium tracking-[-0.035em] text-balance sm:text-[46px] lg:text-[40px] xl:text-[46px]">
                    {title}
                </h2>
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
            <div className="pt-6 sm:px-6">
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
