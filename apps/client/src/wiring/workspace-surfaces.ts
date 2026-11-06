import { CANVAS_NODE_KINDS } from '@/canvas/node-kinds';
import { DATABASE_TAB_BODY } from '@/database/tab-body';
import { DATABASE_TAB_DRAG } from '@/database/tab-drag';
import { DATABASE_VIEW_KIND } from '@/database/view-kind';
import { DESIGN_NODE_KIND, DESIGN_VIEW_KIND } from '@/design/node-kind';
import { DEVICE_NODE_KIND, DEVICE_VIEW_KIND } from '@/devices/node-kind';
import { DIAGRAM_VIEW_KIND } from '@/diagram/view-kind';
import { DRAWING_VIEW_KIND } from '@/drawing/view-kind';
import { EXTENSION_VIEW_KIND } from '@/extensions/view-kind';
import { FILE_VIEW_KIND } from '@/files/view-kind';
import { DIFF_TAB_DRAG } from '@/git/tab-drag';
import { NODE_BODY_KINDS, NODE_VIEW_KINDS } from '@/nodes/node-kinds';
import { ARTIFACT_NODE_KIND, ARTIFACT_VIEW_KIND } from '@/output/node-kind';
import { ARTIFACT_TAB_BODY } from '@/output/tab-body';
import { ARTIFACT_TAB_DRAG } from '@/output/tab-drag';
import { nodeKindRegistry } from '@/registry/node-kinds';
import { viewKindRegistry } from '@/registry/view-kinds';
import { ROUTINE_NODE_KIND } from '@/routines/node-kind';
import { tabBodyRegistry } from '@/state/tab-bodies';
import { tabDragRegistry } from '@/surface/tab-drags';

let installed = false;

/*
 * What a workspace draws by kind: its nodes and views, the bodies of its loose tabs and the drags a cell
 * takes as tabs. Only the harness of the DOM suite and the workspace chunk load it, since the bodies
 * come with the editors and the pages the unit run has no browser for.
 */
export function installWorkspaceSurfaces(): void {
    if (installed) {
        return;
    }
    installed = true;
    nodeKindRegistry.add(...NODE_BODY_KINDS, ...CANVAS_NODE_KINDS, DEVICE_NODE_KIND, ARTIFACT_NODE_KIND, ROUTINE_NODE_KIND, DESIGN_NODE_KIND);
    viewKindRegistry.add(
        ...NODE_VIEW_KINDS,
        DEVICE_VIEW_KIND,
        EXTENSION_VIEW_KIND,
        DRAWING_VIEW_KIND,
        DIAGRAM_VIEW_KIND,
        FILE_VIEW_KIND,
        ARTIFACT_VIEW_KIND,
        DESIGN_VIEW_KIND,
        DATABASE_VIEW_KIND
    );
    tabBodyRegistry.add(DATABASE_TAB_BODY, ARTIFACT_TAB_BODY);
    tabDragRegistry.add(DATABASE_TAB_DRAG, ARTIFACT_TAB_DRAG, DIFF_TAB_DRAG);
}
