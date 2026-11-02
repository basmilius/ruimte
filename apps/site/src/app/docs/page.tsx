import type { ReactNode } from 'react';
import Link from 'next/link';
import { Canvas } from '@/components/docs/guide/Canvas.tsx';
import { ChatApproval } from '@/components/docs/guide/ChatApproval.tsx';
import { GuideIndex } from '@/components/docs/guide/GuideIndex.tsx';
import { NeedsYou } from '@/components/docs/guide/NeedsYou.tsx';
import { Workspace } from '@/components/docs/guide/Workspace.tsx';

const START = [
    { title: 'Install and first project', href: '/docs/guide/getting-started', text: 'Download the app, connect an agent CLI and open a folder.' },
    { title: 'Introduction', href: '/docs/guide', text: 'Machines, projects, views and sessions, in one table.' }
] as const;

/* Three scenes from the guide, each with the page that explains it. */
const CLOSER = [
    { title: 'The canvas', href: '/docs/guide/canvas', text: 'Draw a line from a note or a terminal into a chat, and the agent reads it.', scene: <Canvas /> },
    { title: 'AI chats', href: '/docs/guide/chats', text: 'An agent asks before it runs a command, and you answer on its card.', scene: <ChatApproval /> },
    { title: 'Needs you', href: '/docs/guide/attention', text: 'Every agent that waits for you, in one list, wherever it runs.', scene: <NeedsYou /> }
] as const;

export default function DocsHome() {
    return (
        <main className="mx-auto max-w-[1040px] px-5 py-14 sm:px-8">
            <h1 className="text-4xl font-semibold tracking-tight text-text">Ruimte documentation</h1>
            <p className="mt-4 max-w-2xl text-lg text-text-muted">
                Ruimte runs your terminals, coding agents, browsers and devices side by side on a canvas. Sessions run on your machine, so they keep going when
                you close the window, and you see at once which agent waits for you.
            </p>

            <div className="mt-10">
                <Workspace />
            </div>

            <Heading>Start here</Heading>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {START.map((item) => (
                    <Card key={item.href} {...item} />
                ))}
            </div>

            <Heading>A closer look</Heading>
            <div className="mt-4 grid gap-8 md:grid-cols-3 md:gap-6">
                {CLOSER.map((item) => (
                    <Link key={item.href} href={item.href} className="group flex flex-col gap-3">
                        {/* The scenes differ in shape, so each sits in a box of one shape and the captions line up. */}
                        <div className="flex items-center md:aspect-[16/10]">
                            <div className="w-full">{item.scene}</div>
                        </div>
                        <span className="font-medium text-text group-hover:underline">{item.title}</span>
                        <span className="-mt-2 text-sm text-text-muted">{item.text}</span>
                    </Link>
                ))}
            </div>

            <Heading>Guide</Heading>
            <div className="mt-4">
                <GuideIndex />
            </div>

            <Heading>For developers</Heading>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Card title="Extensions" href="/docs/extensions" text="Add panels, nodes, commands, themes and agent tools to Ruimte." />
                <Card
                    title="Getting started with extensions"
                    href="/docs/extensions/getting-started"
                    text="Build an extension and load it into a running Ruimte."
                />
            </div>
        </main>
    );
}

function Heading({ children }: { readonly children: ReactNode }) {
    return <h2 className="mt-14 text-lg font-semibold text-text">{children}</h2>;
}

function Card({ title, href, text }: { readonly title: string; readonly href: string; readonly text: string }) {
    return (
        <Link href={href} className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-surface-raised">
            <span className="block font-medium text-text">{title}</span>
            <span className="mt-2 block text-sm text-text-muted">{text}</span>
        </Link>
    );
}
