'use client';

import { type MouseEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { siGithub } from 'simple-icons';
import { Pill, Tooltip } from '@adecore/ui';
import { AppIcon } from '@/components/AppIcon.tsx';
import { MobileMenu } from '@/components/MobileMenu.tsx';
import { SECTIONS } from '@/lib/docs/navigation';
import { REPOSITORY_URL, STATION_URL } from '@/lib/release.ts';

/* The display of an item is set where it is used, since some only show from a breakpoint on. */
const ITEM = 'h-9 items-center rounded-md px-2.5 whitespace-nowrap transition-colors sm:px-3';
const ITEM_IDLE = 'text-text-muted hover:bg-surface-hover hover:text-text';
const ITEM_CURRENT = 'bg-surface-active text-text';

function isWithin(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The bar over every page. On the homepage it is glass over the hero until the page scrolls, with the
 * site's menu; in the documentation it holds its ground, and its menu leads back home and to the sections.
 */
export function SiteHeader() {
    const pathname = usePathname();
    const inDocs = isWithin(pathname, '/docs');
    const scrolled = useScrolled();

    return (
        <header
            className={clsx(
                'inset-x-0 top-0 z-30 border-b backdrop-blur-xl transition-colors duration-300',
                inDocs ? 'sticky' : 'fixed',
                inDocs || scrolled ? 'border-border bg-bg/75' : 'border-transparent bg-transparent'
            )}
        >
            <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-5 sm:px-8">
                <span className="flex shrink-0 items-center gap-2.5">
                    <Link href="/" onClick={(event) => toTopOfHome(event, pathname)} className="flex items-center gap-2.5">
                        <AppIcon size={30} />
                        {/* On a phone the docs need the room for their sections, and the icon still says Ruimte. */}
                        <span className={clsx('font-brand text-lg font-semibold tracking-[-0.01em] text-text', inDocs && 'max-sm:sr-only')}>Ruimte</span>
                    </Link>
                    {inDocs && (
                        <Link href="/docs">
                            <Pill>Docs</Pill>
                        </Link>
                    )}
                </span>
                <nav aria-label={inDocs ? 'Documentation' : 'Site'} className="ml-auto flex items-center gap-1 text-xs">
                    {inDocs ? <DocsMenu pathname={pathname} /> : <SiteMenu pathname={pathname} />}
                    <MobileMenu pathname={pathname} section={SECTIONS.find((section) => isWithin(pathname, section.href))} hiddenFrom={inDocs ? 'lg' : 'md'} />
                    <Tooltip label="GitHub" name side="bottom">
                        <a href={REPOSITORY_URL} className={clsx(ITEM, ITEM_IDLE, 'inline-flex px-2.5')}>
                            <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
                                <path d={siGithub.path} />
                            </svg>
                        </a>
                    </Tooltip>
                </nav>
            </div>
        </header>
    );
}

/*
 * A link to the page you are on changes nothing, so on the homepage Home goes back to the top itself, and
 * drops a section's hash such as #features. From any other page the link navigates and lands at the top.
 */
function toTopOfHome(event: MouseEvent<HTMLAnchorElement>, pathname: string): void {
    if (pathname !== '/' || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
        return;
    }

    event.preventDefault();
    window.history.replaceState(window.history.state, '', '/');
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function SiteMenu({ pathname }: { readonly pathname: string }) {
    return (
        <>
            <Link href="/" onClick={(event) => toTopOfHome(event, pathname)} className={clsx(ITEM, ITEM_IDLE, 'hidden md:inline-flex')}>
                Home
            </Link>
            <a href="#features" className={clsx(ITEM, ITEM_IDLE, 'hidden md:inline-flex')}>
                Features
            </a>
            <a href={STATION_URL} className={clsx(ITEM, ITEM_IDLE, 'hidden md:inline-flex')}>
                Station
            </a>
            <Link href="/docs" className={clsx(ITEM, ITEM_IDLE, 'hidden md:inline-flex')}>
                Docs
            </Link>
        </>
    );
}

function DocsMenu({ pathname }: { readonly pathname: string }) {
    return (
        <>
            <Link href="/" className={clsx(ITEM, ITEM_IDLE, 'hidden lg:inline-flex')}>
                Home
            </Link>
            {SECTIONS.map((section) => {
                const current = isWithin(pathname, section.href);

                return (
                    <Link
                        key={section.href}
                        href={section.href}
                        aria-current={current ? 'page' : undefined}
                        className={clsx(ITEM, 'hidden lg:inline-flex', current ? ITEM_CURRENT : ITEM_IDLE)}
                    >
                        {section.title}
                    </Link>
                );
            })}
        </>
    );
}

function useScrolled(): boolean {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const update = () => setScrolled(window.scrollY > 8);

        update();
        window.addEventListener('scroll', update, { passive: true });

        return () => window.removeEventListener('scroll', update);
    }, []);

    return scrolled;
}
