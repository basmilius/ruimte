import i18next from 'i18next';
import type { DatabaseConnection } from '@ruimte/contracts';
import { messageOf } from '@adecore/ui';
import { databaseConnections, ensureDatabaseConnections } from '@/database/connections';
import { useDatabasePanel } from '@/database/state';
import { extensionOf } from '@/shell/panels/file-kind';
import { isDatabaseTab, useFiles, type ConsoleBinding, type TabState } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { windowWorkspace } from '@/state/window';
import { TransportError, type Transport } from '@/transport/transport';

/* A name past this many characters is the start of one; a file system takes 255 bytes and the number still has to fit. */
const BASE_NAME_LENGTH = 80;

/* How many taken names a new console steps past before it gives up, in case another window makes them as fast. */
const CREATE_ATTEMPTS = 20;

/* What a path would read as a separator, or a file system on one of the platforms refuses in a name. */
const UNSAFE_CHARACTERS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

/* Where a project keeps a person's consoles: beside its private file, which the `.gitignore` of `.ruimte` keeps out of git. */
export function consolesFolderOf(folder: string): string {
    return `${folder}/.ruimte/private/consoles`;
}

/* Whether a `.sql` file can run as a console in its tab. */
export function isSqlPath(path: string): boolean {
    return extensionOf(path) === 'sql';
}

/* A connection's name as the start of a file name: what a path or a file system would not take becomes a space. */
export function consoleBaseName(connectionName: string): string {
    const safe = [...connectionName]
        .map((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code < 0x20 || code === 0x7f || UNSAFE_CHARACTERS.has(character) ? ' ' : character;
        })
        .join('');
    const cleaned = safe.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
    return cleaned === '' ? 'console' : cleaned.slice(0, BASE_NAME_LENGTH).trim();
}

export function consoleFileName(base: string, number: number): string {
    return `${base} ${number}.sql`;
}

/* One past the highest number among the consoles of that name, so a console closed a while ago keeps its own. */
export function nextConsoleNumber(base: string, names: readonly string[]): number {
    const prefix = `${base} `;
    let highest = 0;
    for (const name of names) {
        if (!name.startsWith(prefix) || !name.endsWith('.sql')) {
            continue;
        }
        const digits = name.slice(prefix.length, -'.sql'.length);
        if (/^[1-9]\d*$/.test(digits)) {
            highest = Math.max(highest, Number(digits));
        }
    }
    return highest + 1;
}

/* Where a new console runs: the connection of the tab in front, else of the explorer's selection, else the first there is. */
export function consoleContext(
    tabs: TabState,
    selection: { connectionId: string; schema?: string } | null,
    connectionIds: readonly string[]
): ConsoleBinding | null {
    const known = new Set(connectionIds);
    const tab = tabs.tabs.find((candidate) => candidate.key === tabs.active);
    const fromTab = tab === undefined ? undefined : isDatabaseTab(tab) ? { connectionId: tab.connectionId, schema: tab.schema } : tab.console;
    if (fromTab !== undefined && known.has(fromTab.connectionId)) {
        return fromTab;
    }
    if (selection !== null && known.has(selection.connectionId)) {
        return { connectionId: selection.connectionId, ...(selection.schema === undefined ? {} : { schema: selection.schema }) };
    }
    const first = connectionIds[0];
    return first === undefined ? null : { connectionId: first };
}

/* Makes the file under the next free number of its name and answers its path; a name another window took in between is stepped past. */
export async function createConsoleFile(transport: Pick<Transport, 'request'>, folder: string, base: string, text: string): Promise<string> {
    const directory = consolesFolderOf(folder);
    // A project without consoles has no folder yet, which `fs.create` makes.
    const listed = await transport.request('fs.list', { path: directory }).then(
        (result) => result.entries.map((entry) => entry.name),
        () => []
    );
    const first = nextConsoleNumber(base, listed);
    for (let number = first; number < first + CREATE_ATTEMPTS; number += 1) {
        const path = `${directory}/${consoleFileName(base, number)}`;
        try {
            await transport.request('fs.create', { path, kind: 'file', text });
            return path;
        } catch (error: unknown) {
            if (!(error instanceof TransportError && error.code === 'exists')) {
                throw error;
            }
        }
    }
    throw new Error(i18next.t('databases:console.taken', { name: base }));
}

/* A console is a `.sql` file that opens in a tab of its own, bound to its connection, with the caret in it. */
export async function openConsole(connection: DatabaseConnection, binding: ConsoleBinding, sql = ''): Promise<void> {
    const folder = useProject.getState().current?.folder ?? null;
    const transport = windowWorkspace()?.connection.transport ?? null;
    if (folder === null || transport === null) {
        return;
    }
    try {
        const path = await createConsoleFile(transport, folder, consoleBaseName(connection.name), sql);
        const files = useFiles.getState();
        files.open(path, useSettings.getState().filesTabLimit);
        files.setConsole(path, binding);
        files.requestCaret(path);
    } catch (error: unknown) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('databases:console.failed'), description: messageOf(error) });
    }
}

/* A console on the connection a person is looking at; a project without connections gets the dialog to add one. */
export async function openNewConsole(asked?: ConsoleBinding, sql?: string): Promise<void> {
    ensureDatabaseConnections();
    const connections = await databaseConnections.ready();
    if (connections === null) {
        return;
    }
    const ids = connections.map((connection) => connection.id);
    const binding =
        asked !== undefined && ids.includes(asked.connectionId) ? asked : consoleContext(useFiles.getState(), useDatabasePanel.getState().selection, ids);
    const connection = connections.find((candidate) => candidate.id === binding?.connectionId);
    if (binding === null || connection === undefined) {
        useDatabasePanel.getState().openConnections(null);
        return;
    }
    await openConsole(connection, binding, sql);
}
