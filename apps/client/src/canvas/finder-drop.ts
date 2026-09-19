import i18next from 'i18next';
import { finderRefusal, type FinderRefusal } from '@/canvas/drop';
import { desktop } from '@/desktop/bridge';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useToasts } from '@/state/toasts';

/* What a person is told when the drag cannot become anything, in the words of their own machine. */
const refusalToast = (refusal: FinderRefusal, fileManager: string, machine: string | null): { title: string; description: string } => {
    if (refusal === 'no-bridge') {
        return {
            title: i18next.t('canvas:drop.noBridge.title', { app: fileManager }),
            description: i18next.t('canvas:drop.noBridge.description')
        };
    }
    return {
        title: i18next.t('canvas:drop.otherMachine.title', { machine: machine ?? i18next.t('canvas:drop.otherMachine.unknown') }),
        description: i18next.t('canvas:drop.otherMachine.description', { app: fileManager })
    };
};

/*
 * The paths behind a drag out of the file manager, with a toast when there are none to be had. The
 * rules of that refusal are pure in `drop.ts`; this is the shell, the machine and the toast around
 * them. It has to run inside the drop event: the items of a `DataTransfer` are emptied right after.
 */
export const finderPaths = (transfer: DataTransfer, endpointId: string): string[] => {
    const bridge = desktop();
    const pathForFile = bridge?.pathForFile;
    const { platform, reachability, label } = serverInfoOf(endpointId);
    const refusal = finderRefusal(pathForFile !== undefined, reachability);
    if (refusal !== null) {
        useToasts.getState().show({ kind: 'error', ...refusalToast(refusal, fileManagerName(platform), label) });
        return [];
    }
    const paths: string[] = [];
    for (const item of transfer.items) {
        // A folder names a path the way a file does, and a folder on the canvas is a file manager.
        if (item.kind !== 'file' || item.webkitGetAsEntry()?.isDirectory === true) {
            continue;
        }
        const file = item.getAsFile();
        const path = file === null ? null : pathForFile!(file);
        if (path) {
            paths.push(path);
        }
    }
    return paths;
};
