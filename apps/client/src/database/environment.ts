import type { DatabaseFiles, DatabaseStorage } from '@adecore/database';
import type { DesktopBridge } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';

export type DatabaseStorageArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/* A connection id is only unique within its project, so what the views remember is kept per project. */
export function databaseStorageKey(endpointId: string, projectId: string, key: string): string {
    return `ruimte.database:${endpointKey(endpointId, projectId)}:${key}`;
}

/* Where the views keep what a person set. Storage that refuses keeps it for this session only, the way the panels do. */
export function databaseStorage(area: DatabaseStorageArea | null, endpointId: string, projectId: string): DatabaseStorage {
    return {
        get: (key) => {
            try {
                return area?.getItem(databaseStorageKey(endpointId, projectId, key)) ?? null;
            } catch {
                return null;
            }
        },
        set: (key, value) => {
            try {
                if (value === null) {
                    area?.removeItem(databaseStorageKey(endpointId, projectId, key));
                } else {
                    area?.setItem(databaseStorageKey(endpointId, projectId, key), value);
                }
            } catch {
                // Full or refused: the view starts the same next time.
            }
        }
    };
}

/*
 * The file dialogs of this computer, which only name a path on the machine when the machine is this
 * computer. The machine also refuses a file to any client that did not present the local secret.
 */
function localDialogs(endpointId: string, bridge: DesktopBridge | null): Required<Pick<DesktopBridge, 'chooseSavePath' | 'chooseOpenPath'>> | null {
    if (endpointId !== LOCAL_ENDPOINT_ID || bridge?.chooseSavePath === undefined || bridge.chooseOpenPath === undefined) {
        return null;
    }
    return { chooseSavePath: bridge.chooseSavePath, chooseOpenPath: bridge.chooseOpenPath };
}

/* Export and import, or nothing where they cannot be offered: the views leave them out then. */
export function databaseFiles(endpointId: string, bridge: DesktopBridge | null): DatabaseFiles | undefined {
    const dialogs = localDialogs(endpointId, bridge);
    if (dialogs === null) {
        return undefined;
    }
    return {
        save: ({ suggestedName, format }) => dialogs.chooseSavePath({ suggestedName, extension: format }),
        // The views read `.tab` as tab separated too.
        open: ({ formats }) => dialogs.chooseOpenPath({ purpose: 'import', extensions: formats.includes('tsv') ? [...formats, 'tab'] : [...formats] })
    };
}

/* The browse button of a SQLite file and an SSH key, or none, so a person types the path on another machine. */
export function databaseBrowse(endpointId: string, bridge: DesktopBridge | null): ((purpose: 'database' | 'identity') => Promise<string | null>) | undefined {
    const dialogs = localDialogs(endpointId, bridge);
    return dialogs === null ? undefined : (purpose) => dialogs.chooseOpenPath({ purpose });
}
