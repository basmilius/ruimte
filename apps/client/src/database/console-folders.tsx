import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, SquareTerminal, Trash2 } from 'lucide-react';
import { ActionRefusal } from '@ruimte/actions';
import type { ExplorerFolder } from '@adecore/database';
import { ContextMenu, Icon, PromptDialog } from '@adecore/ui';
import { performAsPerson } from '@/actions/client-actions';
import { openConsoleFile } from '@/database/console-file';
import { useConsoleFiles } from '@/database/use-console-files';
import { newEntryPathOf, segmentsOf, validateNewEntry } from '@/shell/panels/file-create';
import { basenameOf, dirnameOf } from '@/shell/panels/files-tree';
import { useServer } from '@/state/server';
import { useToasts } from '@/state/toasts';

/* What a console's menu asked for, which waits for the person in a dialog. */
type ConsoleQuestion = { kind: 'rename' | 'delete'; path: string };

/* A name typed for a console keeps it a console: `.sql` is added where the person left it out. */
export function consoleNameOf(typed: string): string {
    const name = typed.trim();
    return name.toLowerCase().endsWith('.sql') ? name : `${name}.sql`;
}

/*
 * The consoles of the project as a folder under each connection in the explorer, with their menus, and the
 * dialogs those ask through. A console renames and goes to the trash through the same actions a file in the
 * files panel does.
 */
export function useConsoleFolders(): { folders: Record<string, readonly ExplorerFolder[]>; dialogs: React.JSX.Element } {
    const { t } = useTranslation(['databases', 'panels']);
    const files = useConsoleFiles();
    const platform = useServer((state) => state.platform);
    const [question, setQuestion] = useState<ConsoleQuestion | null>(null);
    const [busy, setBusy] = useState(false);

    const folders = useMemo(() => {
        const byConnection: Record<string, readonly ExplorerFolder[]> = {};
        for (const [connectionId, paths] of Object.entries(files)) {
            byConnection[connectionId] = [
                {
                    id: 'consoles',
                    label: t('panel.consoles'),
                    items: paths.map((path) => ({
                        id: path,
                        label: basenameOf(path),
                        icon: SquareTerminal,
                        onOpen: ({ preview }: { preview: boolean }) => openConsoleFile(path, connectionId, preview),
                        menu: (
                            <>
                                <ContextMenu.Item onClick={() => setQuestion({ kind: 'rename', path })}>
                                    <Icon icon={Pencil} size={14} /> {t('panels:files.rename.menu')}
                                </ContextMenu.Item>
                                <ContextMenu.Item onClick={() => setQuestion({ kind: 'delete', path })}>
                                    <Icon icon={Trash2} size={14} /> {t('panels:files.delete')}
                                </ContextMenu.Item>
                            </>
                        )
                    }))
                }
            ];
        }
        return byConnection;
    }, [files, t]);

    const failureOf = (error: unknown): string =>
        error instanceof ActionRefusal
            ? t(`panels:files.rename.refused.${error.code}`, { defaultValue: error.message })
            : error instanceof Error
              ? error.message
              : t('panels:error.generic');

    /* What the name or the machine says against a try is thrown, which the dialog shows under its field and stays open for another. */
    const rename = async (path: string, typed: string): Promise<void> => {
        const name = consoleNameOf(typed);
        const parent = dirnameOf(path);
        if (name === basenameOf(path)) {
            setQuestion(null);
            return;
        }
        const siblings = Object.values(files)
            .flat()
            .filter((candidate) => dirnameOf(candidate) === parent)
            .map((candidate) => ({ name: basenameOf(candidate), path: candidate, kind: 'file' as const }));
        const problem = validateNewEntry(name, 'file', {
            parent,
            atRoot: false,
            windows: platform === 'win32',
            children: (directory) => (directory === parent ? siblings : undefined)
        });
        if (problem !== null) {
            throw new Error(t(`panels:files.create.problem.${problem.problem}`, { name: problem.name }));
        }
        // A folder in the name would take the console away from its connection.
        if (segmentsOf(name, 'file').length > 1) {
            throw new Error(t('console.rename.noFolders'));
        }
        try {
            await performAsPerson('file.rename', { path, to: newEntryPathOf(parent, name, 'file') });
        } catch (error: unknown) {
            throw new Error(failureOf(error));
        }
        setQuestion(null);
    };

    const remove = (path: string): void => {
        setBusy(true);
        performAsPerson('file.delete', { paths: [path] })
            .then(() => setQuestion(null))
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : t('panels:error.generic');
                useToasts.getState().show({ title: t('panels:files.deleteFailed'), description: message, kind: 'error', output: message });
            })
            .finally(() => setBusy(false));
    };

    const renaming = question?.kind === 'rename' ? question.path : null;
    const deleting = question?.kind === 'delete' ? question.path : null;
    const dialogs = (
        <>
            <PromptDialog
                open={renaming !== null}
                title={renaming === null ? t('panels:files.rename.fallback') : t('panels:files.rename.fileTitle', { name: basenameOf(renaming) })}
                description={t('console.rename.description')}
                field={{ mono: true, label: t('panels:files.rename.name'), initial: renaming === null ? '' : basenameOf(renaming) }}
                confirmLabel={t('panels:files.rename.confirm')}
                onConfirm={(typed) => (renaming === null ? undefined : rename(renaming, typed))}
                onOpenChange={() => setQuestion(null)}
            />
            <PromptDialog
                open={deleting !== null}
                title={deleting === null ? t('panels:files.deleteDialog.fallback') : t('panels:files.deleteDialog.fileTitle', { name: basenameOf(deleting) })}
                description={t('panels:files.deleteDialog.fileDescription')}
                confirmLabel={t('panels:files.deleteDialog.confirm')}
                danger
                busy={busy}
                onConfirm={() => {
                    if (deleting !== null) {
                        remove(deleting);
                    }
                }}
                onOpenChange={() => setQuestion(null)}
            />
        </>
    );

    return { folders, dialogs };
}
