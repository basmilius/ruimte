import { clampColumnSize, CloseButton, ErrorBoundary, SlidingColumn, PanelHeader, SectionLabel, Separator, LazyBoundary } from '@adecore/ui';
import clsx from 'clsx';
import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasOverlayControls } from '@/desktop/bridge';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { closesFromRail, usePanelEntries } from '@/shell/panels';
import { useShownPanel, useUi } from '@/state/ui';
import { usePanelGap } from '@/surface/panel-layout';
import { PanelHeaderProvider } from '@/surface/PanelHeaderSlot';
import { useKeyOf } from '@/surface/shortcut-overrides';
import { useInstantWidth } from '@/surface/useInstantWidth';
import { useWindowWidth } from '@/surface/useWindowWidth';

const DEFAULT_WIDTH = 540;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;

/* Keep the inner column at its stored width while the outer split animates, avoiding content reflow. */
export function Panel() {
    const gap = usePanelGap();
    const { t } = useTranslation('shell');
    const panel = useShownPanel();
    const togglePanelKey = useKeyOf('panel-toggle');
    const open = panel.open;
    const [leadingHeaderSlot, setLeadingHeaderSlot] = useState<HTMLElement | null>(null);
    const [titleSignal, setTitleSignal] = useState<HTMLElement | null>(null);
    const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
    const stored = useUi((s) => s.panelWidth);
    const planOpen = useUi((s) => s.planOpen);
    const entry = usePanelEntries().find((candidate) => candidate.kind === panel.kind);
    const Body = entry?.component ?? null;
    const windowWidth = useWindowWidth();
    const bounds = { min: entry?.minWidth ?? 240, max: () => windowWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnSize(bounds, stored ?? DEFAULT_WIDTH);

    const instant = useInstantWidth();

    const label = entry === undefined ? t('panel.fallback') : entry.label !== undefined ? entry.label() : t(`panel.names.${entry.kind}`);

    return (
        <SlidingColumn
            // SlidingColumn draws the element, so a theme's hook is set on it from here.
            ref={(element) => element?.setAttribute('data-surface', 'panel')}
            open={open}
            gap={gap}
            // Beside the sheet its edge is the sheet's; beside an open plan it draws its own line.
            edge={planOpen}
            width={width}
            bounds={bounds}
            instant={instant}
            onWidthChange={(next) => useUi.getState().setPanelWidth(next)}
        >
            {/* An open panel is the rightmost column, so on Windows and Linux the close button would
                land under the native window controls; the inset keeps their width free. */}
            <PanelHeader className={clsx('app-drag', open && hasOverlayControls() && 'toolbar-overlay-inset')}>
                <div ref={setLeadingHeaderSlot} className="contents" />
                <div ref={setTitleSignal} className="panel-title-signal hidden" />
                <SectionLabel className="panel-title shrink-0">{label}</SectionLabel>
                {/* The panel's own controls, between its name and the close button. */}
                <SlotRow place="panelHeader" context={{ panel: panel.kind }} />
                <div ref={setHeaderSlot} className="peer flex grow shrink-0 items-center gap-2" />
                {/* A panel with a toggle in the rail closes there; one without keeps a close button of its own. */}
                {entry !== undefined && !closesFromRail(entry.kind) && (
                    <>
                        <Separator className="peer-empty:hidden" />
                        <CloseButton
                            label={t('panel.close', { name: label })}
                            kbd={togglePanelKey}
                            onClick={() => useUi.getState().setPanel({ open: false })}
                        />
                    </>
                )}
            </PanelHeader>
            <PanelHeaderProvider hosts={{ leading: leadingHeaderSlot, titleSignal, trailing: headerSlot }}>
                <ErrorBoundary label={t('panel.failed')} resetKeys={[panel.kind]} className="min-h-0 grow">
                    <LazyBoundary fallback={<div className="min-h-0 grow" />}>{Body !== null && createElement(Body)}</LazyBoundary>
                </ErrorBoundary>
            </PanelHeaderProvider>
        </SlidingColumn>
    );
}
