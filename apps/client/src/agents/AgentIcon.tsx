import type { AgentKind } from '@ruimte/contracts';
import { BotIcon } from '@hugeicons/core-free-icons';
import { siClaude, siGithubcopilot, siGooglegemini } from 'simple-icons';
import { Icon } from '@/ui/Icon';

// The brand marks from simple-icons (CC0), one path each. Drawn in `currentColor`, so a mark takes
// the color of the row or header it sits in and no color leaves the semantic tokens.
// simple-icons carries no OpenAI mark (it was removed at OpenAI's request), so Codex takes the
// generic agent glyph until there is one we may ship.
const MARKS: Partial<Record<AgentKind, { title: string; path: string }>> = {
    claude: siClaude,
    gemini: siGooglegemini,
    copilot: siGithubcopilot
};

/* The mark of one agent CLI, for a menu row, a palette row and the header of an agent node. */
export function AgentIcon({ kind, size = 14, className }: { kind: AgentKind; size?: number; className?: string }) {
    const mark = MARKS[kind];
    if (!mark) {
        return <Icon icon={BotIcon} size={size} className={className} />;
    }
    return (
        <svg role="img" aria-label={mark.title} viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
            <path d={mark.path} />
        </svg>
    );
}
