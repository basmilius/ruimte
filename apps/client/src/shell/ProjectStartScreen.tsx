import { useTranslation } from 'react-i18next';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { NewViewTiles } from '@/shell/ViewMenu';
import { useProject } from '@/state/project';

export function ProjectStartScreen() {
    const { t } = useTranslation('shell');
    const project = useProject((s) => s.current);
    const endpointId = useProject((s) => s.currentEndpointId);
    if (project === null) {
        return null;
    }
    return (
        <div className="absolute inset-0 flex overflow-auto bg-surface-sunken p-6">
            <section className="m-auto flex w-full max-w-lg flex-col gap-6" aria-labelledby="project-start-title">
                <div className="flex flex-col items-center gap-3 text-center">
                    <ProjectGlyph projectId={project.projectId} endpointId={endpointId ?? undefined} icon={project.icon} color={project.color} size={40} />
                    <div className="flex min-w-0 max-w-full flex-col gap-1">
                        <h1 id="project-start-title" className="break-words text-lg font-semibold text-balance text-text">
                            {project.name}
                        </h1>
                        <p className="break-all text-xs text-text-faint">{project.folder}</p>
                    </div>
                    <p className="text-sm text-pretty text-text-muted">{t('projectStart.description')}</p>
                </div>
                <NewViewTiles size="md" />
            </section>
        </div>
    );
}
