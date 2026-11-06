import { CANVAS_NODE_KINDS } from '@/canvas/node-kinds';
import { DATABASE_TAB_BODY } from '@/database/tab-body';
import { DATABASE_TAB_DRAG } from '@/database/tab-drag';
import { DESIGN_NODE_KIND } from '@/design/node-kind';
import { DEVICE_NODE_KIND } from '@/devices/node-kind';
import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { DIFF_TAB_DRAG } from '@/git/tab-drag';
import { provideInlineEdit } from '@/language/ruimte-editor-language';
import { NODE_BODY_KINDS } from '@/nodes/node-kinds';
import { ARTIFACT_NODE_KIND } from '@/output/node-kind';
import { ARTIFACT_TAB_BODY } from '@/output/tab-body';
import { ARTIFACT_TAB_DRAG } from '@/output/tab-drag';
import { nodeKindRegistry } from '@/registry/node-kinds';
import { ROUTINE_NODE_KIND } from '@/routines/node-kind';
import { tabBodyRegistry } from '@/state/tab-bodies';
import { tabDragRegistry } from '@/surface/tab-drags';
import { installPanels } from '@/wiring/panels';
import { installWorkspaceCommands } from '@/wiring/workspace-commands';
import { installWorkspaceDialogs } from '@/wiring/workspace-dialogs';
import { installWorkspaceEffects } from '@/wiring/workspace-effects';

let installed = false;

/*
 * What only a workspace needs, wired when its chunk loads (`App.tsx`) and by the test harness: the
 * start screen never imports it, so it stays out of the entry chunk.
 */
export function installWorkspace(): void {
    if (installed) {
        return;
    }
    installed = true;
    provideInlineEdit((language) => new InlineEditFeature(language));
    installPanels();
    nodeKindRegistry.add(...NODE_BODY_KINDS, ...CANVAS_NODE_KINDS, DEVICE_NODE_KIND, ARTIFACT_NODE_KIND, ROUTINE_NODE_KIND, DESIGN_NODE_KIND);
    tabBodyRegistry.add(DATABASE_TAB_BODY, ARTIFACT_TAB_BODY);
    tabDragRegistry.add(DATABASE_TAB_DRAG, ARTIFACT_TAB_DRAG, DIFF_TAB_DRAG);
    installWorkspaceEffects();
    installWorkspaceDialogs();
    installWorkspaceCommands();
}
