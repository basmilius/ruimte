'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { neighborsOf } from '@/lib/docs/navigation';

export function PageFooter() {
    const { previous, next } = neighborsOf(usePathname());

    return (
        <nav className="mt-16 flex justify-between gap-4 border-t border-border pt-6 text-sm">
            {previous === null ? (
                <span />
            ) : (
                <Link href={previous.href} className="text-text-muted hover:text-text">
                    ← {previous.title}
                </Link>
            )}
            {next !== null && (
                <Link href={next.href} className="text-text-muted hover:text-text">
                    {next.title} →
                </Link>
            )}
        </nav>
    );
}
