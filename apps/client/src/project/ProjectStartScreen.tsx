import { ScrollArea } from '@adecore/ui';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { isScratchProject, shownFolderOf, useProject } from '@/state/project';
import { NewViewTiles } from '@/views/NewViewMenu';

export function ProjectStartScreen() {
    const project = useProject((s) => s.current);
    const endpointId = useProject((s) => s.currentEndpointId);
    if (project === null) {
        return null;
    }
    const folder = shownFolderOf(project);
    return (
        <ScrollArea className="absolute inset-0 bg-surface" viewportClassName="flex p-6">
            <section className="m-auto flex w-full max-w-2xl flex-col gap-8" aria-labelledby="project-start-title">
                <div className="flex flex-col items-center gap-3 text-center">
                    <span style={{ color: project.color }}>
                        <ProjectGlyph
                            projectId={project.projectId}
                            endpointId={endpointId ?? undefined}
                            icon={project.icon}
                            color={project.color}
                            size={48}
                            scratch={isScratchProject(project)}
                        />
                    </span>
                    <div className="flex min-w-0 max-w-full flex-col gap-1">
                        <h1 id="project-start-title" className="break-words text-xl font-semibold text-balance text-text">
                            {project.name}
                        </h1>
                        {folder !== null && <p className="break-all font-mono text-xs text-text-faint">{folder}</p>}
                    </div>
                </div>
                <NewViewTiles size="md" />
                <SlotRow place="startScreen" context={{}} words wrap={(row) => <div className="flex flex-wrap justify-center gap-2">{row}</div>} />
            </section>
        </ScrollArea>
    );
}
