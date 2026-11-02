'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { Icon, ListRow, SectionLabel } from '@adecore/ui';
import { type NavigationSection, pagesOf } from '@/lib/docs/navigation';

export function Sidebar({ section }: { readonly section: NavigationSection }) {
    const pathname = usePathname();

    return (
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto py-8 lg:block">
            <Pages section={section} pathname={pathname} />
        </aside>
    );
}

/*
 * The sidebar of a phone or a narrow window: the page you are on, which opens to the same list. Keyed on the
 * path, so it closes again once a page is picked.
 */
export function SidebarMenu({ section }: { readonly section: NavigationSection }) {
    const pathname = usePathname();
    const current = pagesOf(section).find((page) => page.href === pathname);

    return (
        <details key={pathname} className="group sticky top-16 z-20 -mx-5 mb-8 border-b border-border bg-bg px-5 sm:-mx-8 sm:px-8 lg:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 py-2 text-sm text-text [&::-webkit-details-marker]:hidden">
                <span className="text-text-muted">{section.title}</span>
                {current !== undefined && (
                    <>
                        <span className="text-text-muted">/</span>
                        <span className="min-w-0">{current.title}</span>
                    </>
                )}
                <Icon
                    icon={ChevronDown}
                    size={16}
                    className="ml-auto shrink-0 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
            </summary>
            {/* The list scrolls within what is left of the screen below the bars. */}
            <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto pb-4">
                <Pages section={section} pathname={pathname} />
            </div>
        </details>
    );
}

function Pages({ section, pathname }: { readonly section: NavigationSection; readonly pathname: string }) {
    return section.groups.map((group) => (
        <nav key={group.title} aria-label={group.title} className="mb-6 last:mb-0">
            <SectionLabel render={<h2 />} className="mb-1 block px-2">
                {group.title}
            </SectionLabel>
            <ul className="flex flex-col gap-px">
                {group.pages.map((page) => {
                    const current = pathname === page.href;

                    return (
                        <li key={page.href}>
                            {/* A title wraps rather than cut off, should one ever be longer than the sidebar is wide. */}
                            <ListRow
                                variant="inset"
                                render={<Link href={page.href} aria-current={current ? 'page' : undefined} />}
                                className={clsx(
                                    'h-auto min-h-8 py-1 text-sm transition-colors',
                                    current ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                                )}
                            >
                                {page.title}
                            </ListRow>
                        </li>
                    );
                })}
            </ul>
        </nav>
    ));
}
