'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavigationSection } from '@/lib/navigation';

export function Sidebar({ section }: { readonly section: NavigationSection }) {
    const pathname = usePathname();

    return (
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto py-10 md:block">
            {section.groups.map((group) => (
                <div key={group.title} className="mb-6">
                    <p className="mb-2 px-3 text-xs font-medium tracking-wide text-text-faint uppercase">{group.title}</p>
                    <ul>
                        {group.pages.map((page) => {
                            const current = pathname === page.href;

                            return (
                                <li key={page.href}>
                                    <Link
                                        href={page.href}
                                        aria-current={current ? 'page' : undefined}
                                        className={`block truncate rounded-md px-3 py-1.5 text-sm ${current ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'}`}
                                    >
                                        {page.title}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </aside>
    );
}
