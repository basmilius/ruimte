import type { ChatUiLinkReading } from '@ruimte/contracts';
import { runAsPerson } from '@/actions/client-actions';
import { desktop } from '@/desktop/bridge';
import { useFiles } from '@/state/files';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useSettings } from '@/state/settings';

export function openUiLink(endpointId: string, reading: ChatUiLinkReading): void {
    if (
        endpointId !== currentEndpointId() ||
        reading.state !== 'chip' ||
        !reading.target ||
        (reading.projectId !== undefined && reading.projectId !== useProject.getState().current?.projectId)
    ) {
        return;
    }
    const target = reading.target;
    if (target.type === 'File') {
        void runAsPerson('file.preview', { path: target.path, line: target.line, endpointId });
    } else if (target.type === 'Diff' && reading.cwd) {
        if (reading.conflicted && reading.relativePath) {
            useUi.getState().setConflicts({ cwd: reading.cwd, path: reading.relativePath });
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
        void (reading.viewId ? runAsPerson('node.focus', { viewId: reading.viewId, nodeId: target.id }) : runAsPerson('view.focus', { viewId: target.id }));
    }
}

export function openUiUrl(endpointId: string, input: string): void {
    if (endpointId !== currentEndpointId()) {
        return;
    }
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
    }
    const bridge = desktop();
    if (bridge) {
        void bridge.openExternal(url.href);
    } else {
        window.open(url.href, '_blank', 'noopener,noreferrer');
    }
}
