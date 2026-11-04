'use client';

import { SectionLabel } from '@adecore/ui';
import Link from 'next/link';
import { SECTIONS } from '@/lib/docs/navigation';

/* Every page of the guide by its sidebar group, so the docs homepage lists what the sidebar lists. */
export function GuideIndex() {
    const guide = SECTIONS.find((section) => section.href === '/docs/guide');

    if (guide === undefined) {
        return null;
    }

    return (
        <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {guide.groups.map((group) => (
                <nav key={group.title} aria-label={group.title}>
                    <SectionLabel render={<h3 />} className="mb-2 block">
                        {group.title}
                    </SectionLabel>
                    <ul className="flex flex-col">
                        {group.pages.map((page) => (
                            <li key={page.href}>
                                <Link href={page.href} className="block border-b border-border py-2 text-sm text-text hover:underline">
                                    {page.title}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            ))}
        </div>
    );
}
