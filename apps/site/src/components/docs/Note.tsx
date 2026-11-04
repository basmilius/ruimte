'use client';

import { Banner } from '@adecore/ui';
import { Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/* A line a reader should not skim past. `warning` is for what can go wrong, the rest is `info`. */
export function Note({ tone = 'info', children }: { readonly tone?: 'info' | 'warning'; readonly children: ReactNode }) {
    return (
        <Banner
            placement="inline"
            icon={tone === 'warning' ? TriangleAlert : Info}
            tone={tone === 'warning' ? 'attention' : 'neutral'}
            message={children}
            className="note"
        />
    );
}
