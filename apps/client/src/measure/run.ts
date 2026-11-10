import { copyText, messageOf } from '@adecore/ui';
import i18next from 'i18next';
import { startRecording, take } from '@/measure/recorder';
import { measureScene, sceneFacts, type MeasureVariant } from '@/measure/scene';
import { openFolderOn } from '@/project/open';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { serverInfoOf } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';

function separatorOf(platform: string | null): string {
    return platform === 'win32' ? '\\' : '/';
}

/* Beside the person's own work and outside `$RUIMTE_HOME`, which a file request may not write. */
function folderFor(home: string, platform: string | null, variant: MeasureVariant): string {
    return [home.replace(/[\\/]+$/, ''), '.cache', 'ruimte-measure', variant].join(separatorOf(platform));
}

function failed(error: unknown): void {
    useToasts.getState().show({ kind: 'error', title: i18next.t('shell:measure.failed'), description: messageOf(error) });
}

/* Lays the nine views out three by three once the document has them; a scene opened over a stored layout starts from one cell. */
function arrangeOnceThere(grid: string[][]): void {
    const wanted = grid.flat();
    const arrange = (): boolean => {
        const state = useDocument.getState();
        if (!wanted.every((id) => state.views.some((view) => view.id === id))) {
            return false;
        }
        state.setActiveView(grid[0]![0]!);
        const document = useDocument.getState();
        if (document.layout?.focus) {
            document.closeOtherCells(document.layout.focus);
        }
        document.dropViewAt(grid[1]![0]!, { column: 0, cell: 0 }, 'right');
        document.dropViewAt(grid[2]![0]!, { column: 1, cell: 0 }, 'right');
        grid.forEach((column, index) => {
            document.dropViewAt(column[1]!, { column: index, cell: 0 }, 'down');
            document.dropViewAt(column[2]!, { column: index, cell: 1 }, 'down');
        });
        return true;
    };
    if (arrange()) {
        return;
    }
    const stop = useDocument.subscribe(() => {
        if (arrange()) {
            stop();
        }
    });
}

/*
 * Writes the scene into its own folder on the machine of this window, as a project of its own, and
 * opens it here. Running it again puts the same scene back over whatever a person changed in it.
 */
export async function buildMeasureScene(variant: MeasureVariant): Promise<void> {
    const endpointId = currentEndpointId();
    const transport = transportFor(endpointId);
    const { home, platform } = serverInfoOf(endpointId);
    if (transport === null || home === null) {
        failed(new Error(i18next.t('shell:measure.noMachine')));
        return;
    }
    const scene = measureScene(variant);
    const folder = folderFor(home, platform, variant);
    const separator = separatorOf(platform);
    try {
        const opened = await transport.request('project.open', { folder, createFolder: true, name: scene.content.name });
        const { projectId } = opened.summary;
        for (const file of scene.files) {
            await transport.request('fs.create', {
                path: [folder, ...file.path.split('/')].join(separator),
                kind: 'file',
                text: file.text,
                projectId,
                overwrite: true
            });
        }
        await transport.request('project.save', { projectId, baseRev: opened.document.rev, content: scene.content });
        if (useProject.getState().current?.projectId !== projectId) {
            await transport.request('project.release', { projectId });
        }
        const outcome = await openFolderOn(endpointId, folder);
        if (outcome !== 'done') {
            return;
        }
        if (scene.grid !== null) {
            arrangeOnceThere(scene.grid);
        }
        startRecording({ ...sceneFacts(scene), folder });
        useToasts.getState().show({ kind: 'success', title: i18next.t('shell:measure.built'), description: i18next.t('shell:measure.recording') });
    } catch (error: unknown) {
        failed(error);
    }
}

export function copyMeasurements(): void {
    const json = JSON.stringify(take(), null, 2);
    console.info(json);
    copyText(json);
    useToasts.getState().show({ kind: 'success', title: i18next.t('shell:measure.copied') });
}
