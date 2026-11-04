'use client';

import { Icon } from '@adecore/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { neighborsOf } from '@/lib/docs/navigation';

/* A title wraps within its half rather than push the other link off a phone's screen. */
const LINK = 'flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text';

export function PageFooter() {
    const { previous, next } = neighborsOf(usePathname());

    return (
        <nav aria-label="Pages" className="mt-16 grid grid-cols-2 gap-4 border-t border-border pt-6">
            {previous !== null && (
                <Link href={previous.href} rel="prev" className={`-ml-2 justify-self-start ${LINK}`}>
                    <Icon icon={ArrowLeft} size={14} className="shrink-0" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{previous.title}</span>
                </Link>
            )}
            {next !== null && (
                <Link href={next.href} rel="next" className={`col-start-2 -mr-2 justify-self-end text-right ${LINK}`}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{next.title}</span>
                    <Icon icon={ArrowRight} size={14} className="shrink-0" />
                </Link>
            )}
        </nav>
    );
}
