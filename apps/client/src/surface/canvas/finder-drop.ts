import i18next from 'i18next';
import { desktop } from '@/desktop/bridge';
import { fileManagerName, serverInfoOf } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { finderRefusal, type FinderRefusal } from '@/surface/canvas/drop';

/* What the drop was meant to become: a node leaves the person the Files panel, a terminal only a path to type. */
type FinderTarget = 'node' | 'terminal';

interface FinderPathOptions {
    /* A folder names a path as a file does, which a terminal can `cd` into and a canvas cannot show. */
    folders?: boolean;
    refusal?: FinderTarget;
}

function refusalToast(refusal: FinderRefusal, fileManager: string, machine: string | null, target: FinderTarget): { title: string; description: string } {
    const suffix = target === 'terminal' ? 'terminalDescription' : 'description';
    if (refusal === 'no-bridge') {
        return {
            title: i18next.t('canvas:drop.noBridge.title', { app: fileManager }),
            description: i18next.t(`canvas:drop.noBridge.${suffix}`)
        };
    }
    return {
        title: i18next.t('canvas:drop.otherMachine.title', { machine: machine ?? i18next.t('canvas:drop.otherMachine.unknown') }),
        description: i18next.t(`canvas:drop.otherMachine.${suffix}`, { app: fileManager })
    };
}

/*
 * The paths behind a drag out of the file manager, with a toast when there are none to be had. The
 * rules of that refusal are pure in `drop.ts`; this is the shell, the machine and the toast around
 * them. It has to run inside the drop event: the items of a `DataTransfer` are emptied right after.
 */
export function finderPaths(transfer: DataTransfer, endpointId: string, options: FinderPathOptions = {}): string[] {
    const bridge = desktop();
    const pathForFile = bridge?.pathForFile;
    const { platform, reachability, label } = serverInfoOf(endpointId);
    const refusal = finderRefusal(pathForFile !== undefined, reachability);
    if (refusal !== null) {
        useToasts.getState().show({ kind: 'error', ...refusalToast(refusal, fileManagerName(platform), label, options.refusal ?? 'node') });
        return [];
    }
    const paths: string[] = [];
    for (const item of transfer.items) {
        // A folder on the canvas is a file manager, so a canvas leaves it out.
        if (item.kind !== 'file' || (options.folders !== true && item.webkitGetAsEntry()?.isDirectory === true)) {
            continue;
        }
        const file = item.getAsFile();
        const path = file === null ? null : pathForFile!(file);
        if (path) {
            paths.push(path);
        }
    }
    return paths;
}
