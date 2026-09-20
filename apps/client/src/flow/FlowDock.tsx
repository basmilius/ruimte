import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, Eye, History, Play, Plus, Power, Redo2, Undo2 } from 'lucide-react';
import { FLOW_BUILT_IN_KINDS, type FlowCardKind } from '@ruimte/contracts';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { visibleRect } from '@/canvas/math';
import { FlowCardPicker, type FlowCardChoice } from '@/flow/FlowCardPicker';
import { CARD_H, CARD_W } from '@/flow/geometry';
import { useRunsDrawer } from '@/flow/runs-drawer';
import { runTarget } from '@/flow/run-target';
import type { FlowStateHandle } from '@/flow/use-flow-state';
import { useFlow, useFlowStore } from '@/state/flow';
import { BTN_GROUP } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { ZoomControls } from '@/ui/ZoomControls';

/* How far the dock floats above whatever is under it, which is what `DockShell` keeps on its own. */
const DOCK_GAP = 16;

/* Everything a person may put on a worksheet, which is what the button on the left offers. */
const EVERY_KIND: readonly FlowCardKind[] = ['trigger', 'condition', 'action', ...FLOW_BUILT_IN_KINDS];

/* The three states of the switch, in the order a person walks through them while building a flow. */
const STATES = ['off', 'watching', 'on'] as const;
type SwitchState = (typeof STATES)[number];

/*
 * The worksheet's dock: what a card is added from, the zoom, the way back, running it by hand, and
 * the switch that decides whether any of it runs on its own. The switch sits apart on the right,
 * because turning a flow on is the one thing here that changes what a machine does without you.
 */
export function FlowDock({ flow }: { flow: FlowStateHandle }) {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const zoom = useFlow((s) => s.camera.zoom);
    const canUndo = useFlow((s) => s.past.length > 0);
    const canRedo = useFlow((s) => s.future.length > 0);
    const content = useFlow((s) => s.content);
    const selection = useFlow((s) => s.selection);
    const { state, known, busy, enable, start } = flow;
    const drawerOpen = useRunsDrawer((s) => s.open);
    const drawerHeight = useRunsDrawer((s) => s.height);
    const [picking, setPicking] = useState(false);

    const cards = Object.keys(content.cards).length;
    const target = runTarget(content, selection);
    const current: SwitchState = !state.enabled ? 'off' : state.watching === true ? 'watching' : 'on';

    /* A new card lands in the middle of what the person is looking at, which is where they are aiming. */
    const add = (choice: FlowCardChoice): void => {
        const { camera, viewport } = store.getState();
        const rect = visibleRect(camera, viewport);
        setPicking(false);
        store.getState().addCard(choice.kind, choice.card, { x: rect.x + rect.w / 2 - CARD_W / 2, y: rect.y + rect.h / 2 - CARD_H / 2 });
    };

    const setSwitch = (next: SwitchState): void => {
        void enable({ enabled: next !== 'off', watching: next === 'watching' });
    };

    return (
        /* The drawer takes the bottom of the worksheet, so the dock stands on top of it. */
        <DockShell data-flow-chrome className="px-4" style={{ bottom: drawerOpen ? drawerHeight + DOCK_GAP : DOCK_GAP }}>
            <Tooltip label={t('dock.add')} name>
                <button className="icon-btn" onClick={() => setPicking(true)}>
                    <Icon icon={Plus} size={16} />
                </button>
            </Tooltip>
            {picking && <FlowCardPicker kinds={EVERY_KIND} onPick={add} onClose={() => setPicking(false)} />}

            <Separator />

            <ZoomControls
                zoom={zoom}
                labels={{
                    out: t('drawing:zoom.out'),
                    in: t('drawing:zoom.in'),
                    presets: t('drawing:zoom.presets'),
                    fit: t('drawing:zoom.fit'),
                    fitEverything: t('drawing:zoom.fitEverything')
                }}
                shortcuts={CANVAS_SHORTCUTS}
                onZoomTo={(next) => store.getState().zoomTo(next)}
                onFitAll={() => store.getState().fitAll()}
            />

            <Separator />

            <div className={BTN_GROUP}>
                <Tooltip label={t('common:action.undo')} kbd={CANVAS_SHORTCUTS.undo} name>
                    <button className="icon-btn" disabled={!canUndo} onClick={() => store.getState().undo()}>
                        <Icon icon={Undo2} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label={t('common:action.redo')} kbd={CANVAS_SHORTCUTS.redo} name>
                    <button className="icon-btn" disabled={!canRedo} onClick={() => store.getState().redo()}>
                        <Icon icon={Redo2} size={16} />
                    </button>
                </Tooltip>
            </div>

            <Separator />

            <div className={BTN_GROUP}>
                <Tooltip label={!state.enabled ? t('dock.runOffHint') : target === null ? t('dock.runHint') : t('dock.run')} name>
                    <button className="icon-btn" disabled={busy || !known || !state.enabled || target === null} onClick={() => void start(target as string)}>
                        <Icon icon={Play} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label={t('dock.runs')} name>
                    <button className="icon-btn" onClick={() => useRunsDrawer.getState().toggle()}>
                        <Icon icon={History} size={16} />
                    </button>
                </Tooltip>
            </div>

            <Separator />

            <Menu.Root>
                <Tooltip label={t(`switch.${current}Hint`)}>
                    <Menu.Trigger
                        className={clsx(
                            'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm',
                            current === 'on' ? 'text-positive-text' : current === 'watching' ? 'text-accent' : 'text-text-muted'
                        )}
                        disabled={busy || !known || cards === 0}
                    >
                        <Icon icon={current === 'watching' ? Eye : Power} size={16} />
                        {t(`switch.${current}`)}
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="end">
                        <Menu.Popup className="menu-popup min-w-64">
                            {STATES.map((option) => (
                                <Menu.Item key={option} className="menu-item items-start" onClick={() => setSwitch(option)}>
                                    <span className="grid h-4 w-4 shrink-0 place-items-center">{option === current && <Icon icon={Check} size={14} />}</span>
                                    <span className="flex min-w-0 flex-col">
                                        <span>{t(`switch.${option}`)}</span>
                                        <span className="text-xs/[inherit] text-text-faint">{t(`switch.${option}Hint`)}</span>
                                    </span>
                                </Menu.Item>
                            ))}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
        </DockShell>
    );
}
