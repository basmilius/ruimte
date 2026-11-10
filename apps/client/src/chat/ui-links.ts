import type { ChatUiLinkReading } from '@ruimte/contracts';
import i18next from 'i18next';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { openInSystemBrowser } from '@/desktop/bridge';
import { currentEndpointId } from '@/state/current-endpoint';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { conflictsDialog } from '@/worktrees/dialogs';

function refuse(key: 'elsewhere' | 'invalidUrl'): void {
    useToasts.getState().show({ kind: 'error', title: i18next.t(`chat:uiLink.${key}`) });
}

export function openUiLink(endpointId: string, reading: ChatUiLinkReading): void {
    if (reading.state !== 'chip' || !reading.target) {
        return;
    }
    if (endpointId !== currentEndpointId() || (reading.projectId !== undefined && reading.projectId !== useProject.getState().current?.projectId)) {
        refuse('elsewhere');
        return;
    }
    const target = reading.target;
    if (target.type === 'File') {
        void perform('file.preview', { path: target.path, line: target.line, endpointId }).catch(ignoreRefusal);
    } else if (target.type === 'Diff' && reading.cwd) {
        if (reading.conflicted && reading.relativePath) {
            conflictsDialog.set({ cwd: reading.cwd, path: reading.relativePath });
        } else {
            useFiles.getState().open(target.path, useSettings.getState().filesTabLimit, {
                kind: 'diff',
                cwd: reading.cwd,
                scope: 'worktree',
                staged: reading.staged ?? false
            });
        }
    } else if (target.type === 'Commit' && reading.cwd) {
        useFiles
            .getState()
            .open(reading.cwd, useSettings.getState().filesTabLimit, { kind: 'diff', cwd: reading.cwd, scope: 'commit', staged: false, commit: target.sha });
    } else if (target.type === 'Node') {
        void (reading.viewId
            ? perform('node.focus', { viewId: reading.viewId, nodeId: target.id }).catch(ignoreRefusal)
            : perform('view.focus', { viewId: target.id }).catch(ignoreRefusal));
    }
}

export function openUiUrl(endpointId: string, input: string): void {
    if (endpointId !== currentEndpointId()) {
        refuse('elsewhere');
        return;
    }
    const url = URL.canParse(input) ? new URL(input) : null;
    if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        refuse('invalidUrl');
        return;
    }
    openInSystemBrowser(url.href);
}
