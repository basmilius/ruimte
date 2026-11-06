import { DATABASE_TAB_BODY } from '@/database/tab-body';
import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { provideInlineEdit } from '@/language/ruimte-editor-language';
import { ARTIFACT_TAB_BODY } from '@/output/tab-body';
import { tabBodyRegistry } from '@/state/tab-bodies';
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
    tabBodyRegistry.add(DATABASE_TAB_BODY, ARTIFACT_TAB_BODY);
    installWorkspaceEffects();
    installWorkspaceDialogs();
    installWorkspaceCommands();
}
