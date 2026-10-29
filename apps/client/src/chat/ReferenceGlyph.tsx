import type { ReferenceIconProps } from '@adecore/agents-react';
import { REFERENCE_ICONS } from '@adecore/agents-react/chat';
import { Icon } from '@adecore/ui';
import { ViewGlyph } from '@/project/ViewGlyph';
import { viewGlyphOf } from '@/shell/cell-view';
import { useSidebarSource } from '@/shell/sidebar-source';

/*
 * The mark a `#` reference wears, the same as its row in the sidebar: a view with the icon a person picked
 * for it, a chat or terminal node with its CLI's. The composer draws it outside every provider, so it reads
 * only stores.
 */
export function ReferenceGlyph({ id, kind, size, className }: ReferenceIconProps) {
    const source = useSidebarSource();
    const view = source.views.find((candidate) => candidate.id === id);

    if (view) {
        return <ViewGlyph {...viewGlyphOf(view)} size={size} className={className} />;
    }

    if (kind === 'chat' || kind === 'terminal' || kind === 'browser') {
        const node = Object.values(source.nodes)
            .flat()
            .find((candidate) => candidate.id === id);

        return <ViewGlyph id={id} kind={kind} provider={node?.provider} size={size} className={className} />;
    }

    return <Icon icon={REFERENCE_ICONS[kind]} size={size} className={className} />;
}
