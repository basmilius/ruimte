import { IconButton } from '@adecore/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface KindIconToggle {
    folded: boolean;
    label: string;
    onToggle: () => void;
}

/*
 * The icon at the start of a header (a node's, or a card's beside one), which turns into the chevron
 * that folds it to its header while the pointer is on the header (`group/header`) or the chevron has
 * the keyboard. The chevron is in the Tab order throughout.
 */
export function KindIcon({ toggle, children }: { toggle: KindIconToggle | null; children: ReactNode }) {
    if (toggle === null) {
        return <span className="flex shrink-0 items-center text-text-muted">{children}</span>;
    }
    return (
        <span className="group/kind relative flex shrink-0 items-center text-text-muted">
            <span className="flex items-center transition-opacity group-hover/header:opacity-0 group-has-[:focus-visible]/kind:opacity-0">{children}</span>
            <IconButton
                icon={toggle.folded ? ChevronRight : ChevronDown}
                size="sm"
                label={toggle.label}
                aria-expanded={!toggle.folded}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/header:opacity-100 focus-visible:opacity-100"
                onClick={toggle.onToggle}
            />
        </span>
    );
}
