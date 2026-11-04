'use client';

import { Banner, Pill } from '@adecore/ui';
import { Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

type Status = 'running' | 'needs-you' | 'idle' | 'error' | 'exited' | 'delegating';

/* The words of `canvas.status.*` in the client, on the tone of the status. */
const STATUS: Record<Status, { readonly label: string; readonly tone: 'accent' | 'needsYou' | 'idle' | 'error' | 'muted' }> = {
    running: { label: 'Running', tone: 'accent' },
    'needs-you': { label: 'Needs you', tone: 'needsYou' },
    idle: { label: 'Idle', tone: 'idle' },
    error: { label: 'Error', tone: 'error' },
    exited: { label: 'Session ended', tone: 'muted' },
    delegating: { label: 'Sub-agents working', tone: 'accent' }
};

export function StatusPill({ status }: { readonly status: Status }) {
    return <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>;
}

/* A short label in a line, such as a mode or a platform. */
export function Label({ children }: { readonly children: ReactNode }) {
    return <Pill>{children}</Pill>;
}

/* A note beside the text: `warning` for something that can cost you work, `note` for the rest. */
export function Note({ tone = 'note', children }: { readonly tone?: 'note' | 'warning'; readonly children: ReactNode }) {
    return (
        <Banner
            placement="inline"
            icon={tone === 'warning' ? TriangleAlert : Info}
            tone={tone === 'warning' ? 'attention' : 'neutral'}
            message={children}
            className="mb-5"
        />
    );
}
