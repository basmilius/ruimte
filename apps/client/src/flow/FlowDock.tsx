import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Plus, Power, Redo2, Undo2 } from 'lucide-react';
import { FLOW_CARDS, type FlowCardKind } from '@ruimte/contracts';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { visibleRect } from '@/canvas/math';
import { CARD_H, CARD_W } from '@/flow/geometry';
import { cardKey } from '@/flow/labels';
import { useFlowSwitch } from '@/flow/use-flow-switch';
import { useFlow, useFlowStore } from '@/state/flow';
import { BTN_GROUP, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { ZoomControls } from '@/ui/ZoomControls';

/* The cards without a source, in the order they are worth reaching for. */
const BUILT_INS: FlowCardKind[] = ['start', 'delay', 'any', 'all', 'note'];

const KINDS = ['trigger', 'condition', 'action'] as const;

/*
 * The worksheet's dock: what a card is added from, the zoom, the way back, and the switch that
 * decides whether any of it runs. The switch sits apart on the right, because turning a flow on is
 * the one thing here that changes what a machine does on its own.
 */
export function FlowDock({ viewId }: { viewId: string }) {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const zoom = useFlow((s) => s.camera.zoom);
    const canUndo = useFlow((s) => s.past.length > 0);
    const canRedo = useFlow((s) => s.future.length > 0);
    const cards = useFlow((s) => Object.keys(s.content.cards).length);
    const { state, known, busy, enable } = useFlowSwitch(viewId);

    /* A new card lands in the middle of what the person is looking at, which is where they are aiming. */
    const add = (kind: FlowCardKind, card?: string): void => {
        const { camera, viewport } = store.getState();
        const rect = visibleRect(camera, viewport);
        store.getState().addCard(kind, card, { x: rect.x + rect.w / 2 - CARD_W / 2, y: rect.y + rect.h / 2 - CARD_H / 2 });
    };

    return (
        <DockShell data-flow-chrome className="px-4">
            <Menu.Root>
                <Tooltip label={t('dock.add')} name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={Plus} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="start">
                        <Menu.Popup className="menu-popup min-w-56">
                            {KINDS.map((kind) => (
                                <div key={kind}>
                                    <div className={MENU_LABEL}>{t(`kinds.${kind}`)}</div>
                                    {FLOW_CARDS.filter((definition) => definition.kind === kind).map((definition) => (
                                        <Menu.Item key={definition.id} className="menu-item" onClick={() => add(kind, definition.id)}>
                                            {t(`cards.${cardKey(definition.id)}.label`)}
                                        </Menu.Item>
                                    ))}
                                </div>
                            ))}
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <div className={MENU_LABEL}>{t('kinds.builtIn')}</div>
                            {BUILT_INS.map((kind) => (
                                <Menu.Item key={kind} className="menu-item" onClick={() => add(kind)}>
                                    {t(`builtIn.${kind}.label`)}
                                </Menu.Item>
                            ))}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

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

            <Tooltip label={state.enabled ? t('switch.offHint') : t('switch.onHint')}>
                <button
                    className={clsx('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm', state.enabled ? 'text-positive-text' : 'text-text-muted')}
                    disabled={busy || !known || cards === 0}
                    onClick={() => void enable(!state.enabled)}
                >
                    <Icon icon={Power} size={16} />
                    {state.enabled ? t('switch.on') : t('switch.off')}
                </button>
            </Tooltip>
        </DockShell>
    );
}
