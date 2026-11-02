'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Pill } from '@adecore/ui';
import { SECTIONS } from '@/lib/docs/navigation';
import { REPOSITORY_URL } from '@/lib/release.ts';

export function DocsHeader() {
    const pathname = usePathname();

    return (
        <header className="sticky top-0 z-30 border-b border-border bg-bg/75 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5 sm:px-8">
                <span className="flex shrink-0 items-center gap-2.5">
                    <Link href="/" className="flex items-center gap-2.5">
                        <img
                            src="/app-icon-128.png"
                            srcSet="/app-icon-64.png 64w, /app-icon-128.png 128w, /app-icon-256.png 256w"
                            sizes="28px"
                            width={28}
                            height={28}
                            alt=""
                            draggable={false}
                        />
                        <span className="font-brand text-lg font-semibold text-text">Ruimte</span>
                    </Link>
                    <Link href="/docs">
                        <Pill>Docs</Pill>
                    </Link>
                </span>
                <nav aria-label="Sections" className="hidden items-center gap-1 text-sm sm:flex">
                    {SECTIONS.map((section) => {
                        const current = pathname === section.href || pathname.startsWith(`${section.href}/`);

                        return (
                            <Link
                                key={section.href}
                                href={section.href}
                                aria-current={current ? 'page' : undefined}
                                className={`rounded-md px-3 py-1.5 transition-colors ${current ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'}`}
                            >
                                {section.title}
                            </Link>
                        );
                    })}
                </nav>
                <nav aria-label="Ruimte" className="ml-auto flex items-center gap-5 text-sm">
                    <a href={REPOSITORY_URL} className="hidden text-text-muted transition-colors hover:text-text md:inline">
                        GitHub
                    </a>
                    <a
                        href="/#download"
                        className="inline-flex items-center rounded-md border border-border-strong px-3.5 py-1.5 font-medium text-text transition-colors hover:bg-surface-hover"
                    >
                        Download
                    </a>
                </nav>
            </div>
        </header>
    );
}
