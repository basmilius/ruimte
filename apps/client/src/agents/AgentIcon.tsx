import type { AgentKind } from '@ruimte/contracts';
import clsx from 'clsx';
import { Bot } from 'lucide-react';
import { siClaude, siGithubcopilot, siGooglegemini } from 'simple-icons';
import { Icon } from '@/ui/Icon';
import { PROVIDER_PATHS } from '@/ui/ProviderLogo';

// The brand marks from simple-icons (CC0), one path each, drawn in `currentColor` so a mark takes
// the color of the row or header it sits in. simple-icons carries no OpenAI mark (it was removed
// at OpenAI's request), so Codex borrows the one the usage page already draws.
const MARKS: Partial<Record<AgentKind, { title: string; path: string }>> = {
    claude: siClaude,
    codex: { title: 'Codex', path: PROVIDER_PATHS.codex },
    gemini: siGooglegemini,
    copilot: siGithubcopilot
};

/* The mark of one agent CLI, for a menu row, a palette row and the header of an agent node. */
export function AgentIcon({ kind, size = 14, className }: { kind: AgentKind; size?: number; className?: string }) {
    const mark = MARKS[kind];
    if (!mark) {
        return <Icon icon={Bot} size={size} className={className} />;
    }
    return (
        <svg role="img" aria-label={mark.title} viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={clsx('align-middle', className)}>
            <path d={mark.path} />
        </svg>
    );
}
