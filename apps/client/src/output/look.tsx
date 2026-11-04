import { Icon } from '@adecore/ui';
import { kindIcon } from '@/output/kinds';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useProjectList } from '@/state/project-list';

/* The square mark of a kind at the start of a row or a chip. */
export function KindTile({ kind, size = 'md' }: { kind: string; size?: 'sm' | 'md' }) {
    return (
        <span
            aria-hidden="true"
            className={`grid shrink-0 place-items-center rounded-md bg-surface-sunken text-text-muted dark:bg-field dark:inset-ring dark:inset-ring-field-border ${size === 'md' ? 'size-8' : 'size-5'}`}
        >
            <Icon icon={kindIcon(kind)} size={size === 'md' ? 16 : 12} />
        </span>
    );
}

/* The project's own mark, for a row of Output that may come from any project on the machine. */
export function OutputProjectGlyph({ endpointId, projectId, size = 14 }: { endpointId: string; projectId: string; size?: number }) {
    const summary = useProjectList((s) => s.projects.find((row) => row.endpointId === endpointId && row.summary.projectId === projectId)?.summary);
    if (summary === undefined) {
        return null;
    }
    return (
        <ProjectGlyph projectId={projectId} endpointId={endpointId} icon={summary.icon} color={summary.color} size={size} scratch={summary.scratch === true} />
    );
}
