import { useEffect, useRef } from 'react';
import type { EditorLanguage } from '@/language/editor-language';
import { useGitSignal } from '@/state/git-watch';
import { useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { useTransport } from '@/transport/context';
import { useGitRoot } from '@/shell/panels/use-git-root';

/*
 * Tells the rows above declarations who wrote the file, which git answers for the text on disk. It is
 * asked again when that text or the commit at the head of the checkout changes, and never for what is
 * typed: the rows map their own lines through the edits.
 */
export function useGitBlame(language: EditorLanguage | null, path: string, disk: string): void {
    const transport = useTransport();
    const authors = useSettings((s) => s.codeVisionAuthors);
    const root = useGitRoot(path);
    // Goes up when the checkout moved; the head tells whether that moved the blame.
    const signal = useGitSignal(root ?? null);
    const shown = useRef<{ head: string; disk: string } | null>(null);

    // Held for the answer while it is on its way, so the rows keep room for it.
    useEffect(() => {
        shown.current = null;
        if (language !== null) {
            language.codeVision.setBlame(authors ? { kind: 'pending' } : null);
        }
    }, [language, authors, path]);

    useEffect(() => {
        if (language === null || !authors || root === undefined) {
            return;
        }
        if (root === null || !path.startsWith(`${root}/`)) {
            language.codeVision.setBlame(null);
            return;
        }
        let alive = true;
        const relative = path.slice(root.length + 1);
        void (async () => {
            const head = await transport
                .request('git.log', { cwd: root, limit: 1 })
                .then((log) => log.commits[0]?.hash ?? '')
                .catch(() => null);
            const before = shown.current;
            if (!alive || (before !== null && before.head === head && before.disk === disk)) {
                return;
            }
            const blame = await transport.request('git.blame', { cwd: root, path: relative }).catch(() => null);
            if (!alive) {
                return;
            }
            if (blame === null || blame.omitted !== undefined) {
                shown.current = null;
                language.codeVision.setBlame(null);
                return;
            }
            shown.current = { head: head ?? '', disk };
            language.codeVision.setBlame({
                kind: 'ready',
                blame,
                base: disk,
                openCommit: (hash) =>
                    useFiles
                        .getState()
                        .open(root, useSettings.getState().filesTabLimit, { kind: 'diff', cwd: root, scope: 'commit', staged: false, commit: hash })
            });
        })();
        return () => {
            alive = false;
        };
    }, [language, authors, transport, root, path, signal, disk]);
}
