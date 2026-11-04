'use client';

import { ListRow, SectionLabel } from '@adecore/ui';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavigationSection } from '@/lib/docs/navigation';

export function Sidebar({ section }: { readonly section: NavigationSection }) {
    const pathname = usePathname();

    return (
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto py-8 lg:block">
            <SidebarPages section={section} pathname={pathname} />
        </aside>
    );
}

/* Below `lg` the same list stands in the header's menu. */
export function SidebarPages({ section, pathname }: { readonly section: NavigationSection; readonly pathname: string }) {
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
