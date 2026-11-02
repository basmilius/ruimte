'use client';

import { type MouseEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import clsx from 'clsx';
import { Menu, X } from 'lucide-react';
import { IconButton } from '@adecore/ui';
import { SidebarPages } from '@/components/docs/Sidebar';
import { type NavigationSection, SECTIONS } from '@/lib/docs/navigation';
import { STATION_URL } from '@/lib/release.ts';

const LINK = 'flex min-h-11 items-center rounded-md px-2 text-base transition-colors';
const LINK_IDLE = 'text-text-muted hover:bg-surface-hover hover:text-text';
const LINK_CURRENT = 'bg-surface-active text-text';

interface MobileMenuProps {
    readonly pathname: string;

    /* The docs section the page is in, whose pages the menu lists under the site's links. */
    readonly section: NavigationSection | undefined;

    /* From which width the header shows its own links, so the button steps aside there. */
    readonly hiddenFrom: 'md' | 'lg';
}

/*
 * The header's menu on a phone or a narrow window: the site's links and, in the docs, the pages of the
 * section, over the whole page below the bar. It is open only for the page it was opened on, so picking a
 * page closes it.
 */
export function MobileMenu({ pathname, section, hiddenFrom }: MobileMenuProps) {
    const [openOn, setOpenOn] = useState<string | null>(null);
    const open = openOn === pathname;

    useEffect(() => {
        if (!open) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpenOn(null);
            }
        };
        const root = document.documentElement;
        const overflow = root.style.overflow;

        // The page under the menu holds still, so a scroll in the list never moves it.
        root.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);

        return () => {
            root.style.overflow = overflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // A link to a part of the page you are on navigates nowhere, so a press on any link closes the menu.
    const closeOnLink = (event: MouseEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest('a') !== null) {
            setOpenOn(null);
        }
    };

    return (
        <div className={hiddenFrom === 'md' ? 'md:hidden' : 'lg:hidden'}>
            <IconButton
                icon={open ? X : Menu}
                label={open ? 'Close menu' : 'Menu'}
                tooltip={false}
                aria-expanded={open}
                aria-controls="site-menu"
                onClick={() => setOpenOn(open ? null : pathname)}
            />
            {/* Out of the header, whose backdrop filter would make it the box a fixed panel fills. */}
            {open &&
                createPortal(
                    <div id="site-menu" className="fixed inset-x-0 top-16 bottom-0 z-30 overflow-y-auto border-t border-border bg-bg" onClick={closeOnLink}>
                        <div className="mx-auto max-w-[1240px] px-5 py-6 sm:px-8">
                            <nav aria-label="Site" className="flex flex-col gap-px">
                                <Link href="/" className={clsx(LINK, pathname === '/' ? LINK_CURRENT : LINK_IDLE)}>
                                    Home
                                </Link>
                                <Link href="/#features" className={clsx(LINK, LINK_IDLE)}>
                                    Features
                                </Link>
                                <a href={STATION_URL} className={clsx(LINK, LINK_IDLE)}>
                                    Station
                                </a>
                                {SECTIONS.map((each) => (
                                    <Link
                                        key={each.href}
                                        href={each.href}
                                        aria-current={pathname === each.href ? 'page' : undefined}
                                        className={clsx(LINK, each === section ? LINK_CURRENT : LINK_IDLE)}
                                    >
                                        {each.title}
                                    </Link>
                                ))}
                            </nav>
                            {section !== undefined && (
                                <div className="mt-6 border-t border-border pt-6">
                                    <SidebarPages section={section} pathname={pathname} />
                                </div>
                            )}
                        </div>
                    </div>,
                    document.body
                )}
        </div>
    );
}
