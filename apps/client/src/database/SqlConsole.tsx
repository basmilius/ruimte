import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Unplug } from 'lucide-react';
import type { Editor } from '@adecore/editor';
import { QueryConsole, useDatabaseClient, type Connection, type QueryConsoleEditorProps, type QueryConsoleRunScope } from '@adecore/database';
import type { SchemaInfo } from '@adecore/database/protocol';
import { Button, EmptyState, matchesShortcut, Select, shortcut } from '@adecore/ui';
import { asViewConnections, ensureDatabaseConnections, useDatabaseConnectionList, useDatabaseConnections } from '@/database/connections';
import { RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { isApplePlatform } from '@/desktop/bridge';
import { useFiles, type ConsoleBinding } from '@/state/files';

/* The keys the console's toolbar names for its two runs, bound in the file's own editor. */
const RUN_SHORTCUT = shortcut('Mod+Enter');
const RUN_ALL_SHORTCUT = shortcut('Mod+Shift+Enter');

/* What the picker offers to leave the console for the file alone, which no connection id can be. */
const AS_FILE = '';

/* The text of the editor as it is now, or what the file read as while there is no editor, such as on a touch screen. */
function useEditorText(editor: Editor | null, fallback: string): string {
    const subscribe = useCallback((listener: () => void) => (editor === null ? () => undefined : editor.onChange(listener)), [editor]);
    return useSyncExternalStore(subscribe, () => editor?.getText() ?? fallback);
}

interface SqlConsoleProps {
    tabKey: string;
    binding: ConsoleBinding;
    /* The file's editor once it is there, which a run reads the selection from. */
    editor: Editor | null;
    /* What the file read as, for a run before the editor is there. */
    text: string;
    readOnly: boolean;
    /* The file's editor with its find bar, drawn where the console puts its editor. */
    children: ReactNode;
}

/*
 * A `.sql` file in its tab, run on a connection: the console's toolbar, history and results around the file's
 * own editor, which keeps its keymap, find, saving and language features. The text is the file's, so a run
 * runs what the file holds and a run from the history is an edit of the file.
 */
export function SqlConsole({ tabKey, binding, editor, text, readOnly, children }: SqlConsoleProps) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();
    const status = useDatabaseConnections((state) => state.status);
    const found = connections.find((connection) => connection.id === binding.connectionId);
    const value = useEditorText(editor, text);

    useEffect(() => ensureDatabaseConnections(), []);

    const replaceText = (sql: string): void => {
        if (editor === null || readOnly || sql === editor.getText()) {
            return;
        }
        const end = editor.positionAt(editor.getText().length);
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end }, text: sql }]);
        editor.focus();
    };

    if (found === undefined) {
        // While the list is read a console cannot know yet whether its connection is still there.
        return status === 'ready' ? (
            <EmptyState
                icon={Unplug}
                className="grow"
                action={
                    <Button size="sm" variant="secondary" onClick={() => useFiles.getState().setConsole(tabKey, null)}>
                        {t('console.asFile')}
                    </Button>
                }
            >
                {t('console.gone')}
            </EmptyState>
        ) : null;
    }
    const [connection] = asViewConnections([found]);
    if (connection === undefined) {
        return null;
    }

    return (
        <RuimteDatabaseProvider>
            <QueryConsole
                connection={connection}
                schema={binding.schema}
                value={value}
                onValueChange={replaceText}
                renderEditor={(props) => (
                    <ConsoleEditor {...props} editor={editor}>
                        {children}
                    </ConsoleEditor>
                )}
                className="min-h-0 grow"
            />
        </RuimteDatabaseProvider>
    );
}

/* Hands the console the selection of the file's editor and runs on its two keys, which only a tab in console mode binds. */
function ConsoleEditor({ ref, run, value, editor, children }: QueryConsoleEditorProps & { editor: Editor | null; children: ReactNode }) {
    const runRef = useRef(run);

    useEffect(() => {
        runRef.current = run;
    });

    useImperativeHandle(
        ref,
        () => ({
            selection: () => {
                if (editor === null) {
                    return { start: 0, end: value.length };
                }
                const { start, end } = editor.getSelection();
                const from = editor.offsetAt(start);
                const to = editor.offsetAt(end);
                return { start: Math.min(from, to), end: Math.max(from, to) };
            }
        }),
        [editor, value]
    );

    useEffect(() => {
        if (editor === null) {
            return;
        }
        const apple = isApplePlatform();
        return editor.onKeyDown((event) => {
            const scope: QueryConsoleRunScope | null = matchesShortcut(RUN_ALL_SHORTCUT, event, apple)
                ? 'all'
                : matchesShortcut(RUN_SHORTCUT, event, apple)
                  ? 'selection-or-statement'
                  : null;
            if (scope === null) {
                return false;
            }
            runRef.current(scope);
            return true;
        });
    }, [editor]);

    return children;
}

/*
 * The connection and the schema a `.sql` file runs on, in its toolbar. Picking a connection puts the tab in
 * console mode, and picking none takes it back to the file alone.
 */
export function SqlConsolePicker({ tabKey, binding }: { tabKey: string; binding: ConsoleBinding | undefined }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();
    const found = connections.find((connection) => connection.id === binding?.connectionId);
    const [connection] = found === undefined ? [] : asViewConnections([found]);

    useEffect(() => ensureDatabaseConnections(), []);

    if (connections.length === 0) {
        return null;
    }
    return (
        <>
            <Select
                size="sm"
                variant="ghost"
                label={t('console.runOn')}
                placeholder={t('console.runOn')}
                value={binding?.connectionId ?? null}
                items={[
                    ...(binding === undefined ? [] : [{ value: AS_FILE, label: t('console.asFile') }]),
                    ...connections.map((entry) => ({ value: entry.id, label: entry.name === '' ? t('console.untitled') : entry.name }))
                ]}
                onValueChange={(id) => useFiles.getState().setConsole(tabKey, id === AS_FILE ? null : { connectionId: id })}
            />
            {binding !== undefined && connection !== undefined && (
                <RuimteDatabaseProvider>
                    <SchemaSelect tabKey={tabKey} binding={binding} connection={connection} />
                </RuimteDatabaseProvider>
            )}
        </>
    );
}

/* The schemas a person can pick, once the connection has listed them; a connection with one, such as a SQLite file, offers no choice. */
function SchemaSelect({ tabKey, binding, connection }: { tabKey: string; binding: ConsoleBinding; connection: Connection }) {
    const { t } = useTranslation('databases');
    const client = useDatabaseClient();
    const [schemas, setSchemas] = useState<readonly SchemaInfo[]>([]);

    useEffect(() => {
        const controller = new AbortController();
        client
            .session(connection)
            .schemas({ signal: controller.signal })
            .then((listed) => setSchemas(listed.filter((schema) => !schema.system)))
            .catch(() => setSchemas([]));
        return () => controller.abort();
    }, [client, connection]);

    if (schemas.length < 2) {
        return null;
    }
    return (
        <Select
            size="sm"
            variant="ghost"
            label={t('console.schema')}
            placeholder={t('console.defaultSchema')}
            value={binding.schema ?? null}
            items={schemas.map((schema) => ({ value: schema.name, label: schema.name }))}
            onValueChange={(schema) => useFiles.getState().setConsole(tabKey, { connectionId: binding.connectionId, schema })}
        />
    );
}
