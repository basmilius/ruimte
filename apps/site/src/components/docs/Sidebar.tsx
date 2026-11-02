'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { ListRow, SectionLabel } from '@adecore/ui';
import type { NavigationSection } from '@/lib/docs/navigation';

export function Sidebar({ section }: { readonly section: NavigationSection }) {
    const pathname = usePathname();

    return (
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto py-8 md:block">
            {section.groups.map((group) => (
                <nav key={group.title} aria-label={group.title} className="mb-6">
                    <SectionLabel render={<h2 />} className="mb-1 block px-2">
                        {group.title}
                    </SectionLabel>
                    <ul className="flex flex-col gap-px">
                        {group.pages.map((page) => {
                            const current = pathname === page.href;

                            return (
                                <li key={page.href}>
                                    <ListRow
                                        variant="inset"
                                        render={<Link href={page.href} aria-current={current ? 'page' : undefined} />}
                                        className={clsx(
                                            'text-sm transition-colors',
                                            current ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                                        )}
                                    >
                                        <span className="truncate">{page.title}</span>
                                    </ListRow>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            ))}
        </aside>
    );
}
