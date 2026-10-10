import { useCallback, useEffect, useImperativeHandle, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Database } from 'lucide-react';
import type { Editor } from '@adecore/editor';
import { QueryConsole, type QueryConsoleEditorProps, type QueryConsoleRunScope } from '@adecore/database';
import { Button, Icon, matchesShortcut, Menu, Select, shortcut } from '@adecore/ui';
import { asViewConnections, ensureDatabaseConnections, useDatabaseConnectionList } from '@/database/connections';
import { setConsoleSchema, switchConsoleConnection } from '@/database/console-file';
import { RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { useDatabasePanel } from '@/database/state';
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
    /* Where the file runs, or undefined while it is the file alone. */
    binding: ConsoleBinding | undefined;
    /* The file's editor once it is there, which a run reads the selection from. */
    editor: Editor | null;
    /* What the file read as, for a run before the editor is there. */
    text: string;
    readOnly: boolean;
    /* The file's editor with its find bar, drawn where the console puts its editor. */
    children: ReactNode;
}

/*
 * A `.sql` file in its tab, as a console around the file's own editor, which keeps its keymap, find, saving
 * and language features. The text is the file's, so a run from the history is an edit of the file. The
 * connection and schema are kept on the tab.
 */
export function SqlConsole({ tabKey, binding, editor, text, readOnly, children }: SqlConsoleProps) {
    const connections = useDatabaseConnectionList();
    const found = connections.find((connection) => connection.id === binding?.connectionId);
    const [connection] = found === undefined ? [] : asViewConnections([found]);
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

    return (
        <RuimteDatabaseProvider>
            <QueryConsole
                connection={connection}
                schema={binding?.schema}
                onSchemaChange={(schema) => {
                    if (binding !== undefined) {
                        setConsoleSchema(tabKey, binding, schema);
                    }
                }}
                toolbarEnd={connection === undefined ? <RunOnConnection path={tabKey} /> : <SqlConsolePicker path={tabKey} binding={binding} />}
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

/* What a file that runs nowhere has in its bar: the connections of the project to run it on, or a way to add one. */
function RunOnConnection({ path }: { path: string }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();

    if (connections.length === 0) {
        return (
            <Button size="sm" variant="secondary" onClick={() => useDatabasePanel.getState().openConnections()}>
                <Icon icon={Database} size={12} />
                {t('console.runOn')}
            </Button>
        );
    }
    return (
        <Menu.Root>
            <Menu.Trigger render={<Button size="sm" variant="secondary" />}>
                <Icon icon={Database} size={12} />
                {t('console.runOn')}
                <Icon icon={ChevronDown} size={12} />
            </Menu.Trigger>
            <Menu.Popup align="end">
                {connections.map((entry) => (
                    <Menu.Item key={entry.id} onClick={() => void switchConsoleConnection(path, entry.id)}>
                        {entry.name === '' ? t('console.untitled') : entry.name}
                    </Menu.Item>
                ))}
            </Menu.Popup>
        </Menu.Root>
    );
}

function runScopeOf(event: KeyboardEvent, apple: boolean): QueryConsoleRunScope | null {
    if (matchesShortcut(RUN_ALL_SHORTCUT, event, apple)) {
        return 'all';
    }
    return matchesShortcut(RUN_SHORTCUT, event, apple) ? 'selection-or-statement' : null;
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
            const scope = runScopeOf(event, apple);
            if (scope === null) {
                return false;
            }
            runRef.current(scope);
            return true;
        });
    }, [editor]);

    return children;
}

/* The connection a console runs on, in its bar: another one runs it there, and Just the file takes the bar back to Run on a connection. */
function SqlConsolePicker({ path, binding }: { path: string; binding: ConsoleBinding | undefined }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();

    useEffect(() => ensureDatabaseConnections(), []);

    if (connections.length === 0) {
        return null;
    }
    return (
        <Select
            size="sm"
            label={t('console.runOn')}
            placeholder={t('console.runOn')}
            value={binding?.connectionId ?? null}
            items={[
                ...(binding === undefined ? [] : [{ value: AS_FILE, label: t('console.asFile') }]),
                ...connections.map((entry) => ({ value: entry.id, label: entry.name === '' ? t('console.untitled') : entry.name }))
            ]}
            onValueChange={(id) => {
                if (id === AS_FILE) {
                    useFiles.getState().setConsole(path, null);
                } else {
                    void switchConsoleConnection(path, id);
                }
            }}
        />
    );
}
