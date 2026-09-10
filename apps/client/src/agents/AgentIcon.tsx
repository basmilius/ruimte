import type { AgentKind } from '@ruimte/contracts';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faClaude, faCopilot, faGoogle, faOpenai } from '@fortawesome/free-brands-svg-icons';
import { Icon } from '@/ui/Icon';

// Font Awesome has no Gemini spark, so the Gemini CLI takes the Google mark it ships under.
const MARKS: Record<AgentKind, IconDefinition> = {
    claude: faClaude,
    codex: faOpenai,
    gemini: faGoogle,
    copilot: faCopilot
};

/* The mark of one agent CLI, for a menu row, a palette row and the header of an agent node. */
export function AgentIcon({ kind, size = 14, className }: { kind: AgentKind; size?: number; className?: string }) {
    return <Icon icon={MARKS[kind]} size={size} className={className} />;
}
