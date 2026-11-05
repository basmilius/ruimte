import type { ReferenceIconProps } from '@adecore/agents-react';
import { REFERENCE_ICONS } from '@adecore/agents-react/chat';
import { Icon } from '@adecore/ui';
import { useReachedReferables } from '@/chat/reached-referables';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ViewGlyph } from '@/project/ViewGlyph';
import { useProject } from '@/state/project';
import { viewGlyphOf } from '@/surface/cell-view';
import { useSidebarSource } from '@/surface/sidebar-source';

/*
 * The mark a `#` reference wears, the same as its row in the sidebar: a view with the icon a person picked
 * for it, a chat or terminal node with its CLI's. The composer draws it outside every provider, so it reads
 * only stores.
 */
export function ReferenceGlyph({ id, kind, size, className }: ReferenceIconProps) {
    const source = useSidebarSource();
    const view = source.views.find((candidate) => candidate.id === id);
    const own = useProject((s) => s.current);
    const reached = useReachedReferables((s) => s.byEndpoint);

    if (kind === 'project') {
        const project =
            own?.projectId === id
                ? own
                : Object.values(reached)
                      .flat()
                      .find((entry) => entry.project.projectId === id)?.project;

        return project ? (
            <ProjectGlyph projectId={id} icon={project.icon} color={project.color} size={size} className={className} />
        ) : (
            <Icon icon={REFERENCE_ICONS.project} size={size} className={className} />
        );
    }

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
