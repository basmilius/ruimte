'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Icon, ListRow } from '@adecore/ui';
import { neighborsOf } from '@/lib/docs/navigation';

const LINK = 'gap-2 text-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text';

export function PageFooter() {
    const { previous, next } = neighborsOf(usePathname());

    return (
        <nav aria-label="Pages" className="mt-16 flex justify-between gap-4 border-t border-border pt-6">
            {previous !== null && (
                <ListRow variant="inset" render={<Link href={previous.href} rel="prev" />} className={`-ml-2 ${LINK}`}>
                    <Icon icon={ArrowLeft} size={14} />
                    {previous.title}
                </ListRow>
            )}
            {next !== null && (
                <ListRow variant="inset" render={<Link href={next.href} rel="next" />} className={`-mr-2 ml-auto ${LINK}`}>
                    {next.title}
                    <Icon icon={ArrowRight} size={14} />
                </ListRow>
            )}
        </nav>
    );
}
