import { Activity, CircleAlert, Database, Folder, GitBranch, Mic, Package, Rocket, TabletSmartphone, type LucideIcon } from 'lucide-react';
import { panelHidden, type PanelKind } from '@/state/ui';

export type PanelGroup = 'project' | 'connected' | 'made';

/*
 * The panels, in the order their buttons sit in the rail. They share one stored width and each
 * clamps it to its own `minWidth` on screen only, so a wide minimum never overwrites it. A panel
 * without a button opens elsewhere: Processes and Problems from the Window menu, Launches from the
 * launches menu, and Voice Control from its own button at the rail's foot, which only shows while a key is set.
 */
export const PANELS: { kind: PanelKind; icon: LucideIcon; minWidth: number; toolbar: boolean; group: PanelGroup }[] = [
    { kind: 'files', icon: Folder, minWidth: 240, toolbar: true, group: 'project' },
    { kind: 'git', icon: GitBranch, minWidth: 240, toolbar: true, group: 'project' },
    { kind: 'databases', icon: Database, minWidth: 260, toolbar: true, group: 'connected' },
    { kind: 'devices', icon: TabletSmartphone, minWidth: 320, toolbar: true, group: 'connected' },
    { kind: 'output', icon: Package, minWidth: 300, toolbar: true, group: 'made' },
    { kind: 'processes', icon: Activity, minWidth: 420, toolbar: false, group: 'project' },
    { kind: 'launches', icon: Rocket, minWidth: 480, toolbar: false, group: 'project' },
    { kind: 'problems', icon: CircleAlert, minWidth: 360, toolbar: false, group: 'project' },
    { kind: 'voice', icon: Mic, minWidth: 320, toolbar: false, group: 'project' }
];

/* Whether a button in the rail toggles the panel: one of the panel buttons, or Voice Control's own. The
   rest open from a menu and close from their own header. */
export function closesFromRail(kind: PanelKind): boolean {
    return kind === 'voice' || PANELS.some((entry) => entry.kind === kind && entry.toolbar);
}

/* The panels with a button in the rail of a project, which the Chats project has fewer of. */
export function toolbarPanels(scratch: boolean) {
    return PANELS.filter((entry) => entry.toolbar && !panelHidden(entry.kind, scratch));
}
