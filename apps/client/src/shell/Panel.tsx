import { clampColumnSize, CloseButton, ErrorBoundary, SlidingColumn, lazyNamed, PanelHeader, SectionLabel, Separator, LazyBoundary } from '@adecore/ui';
import clsx from 'clsx';
import { createElement, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { hasOverlayControls } from '@/desktop/bridge';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { usePanelGap } from '@/shell/panel-layout';
import { closesFromRail, usePanelEntries, type CorePanel, type PanelEntry } from '@/shell/panels';
import { DevicesPanel } from '@/shell/panels/DevicesPanel';
import { FilesPanel } from '@/shell/panels/FilesPanel';
import { ProcessesPanel } from '@/shell/panels/ProcessesPanel';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { useShownPanel, useUi } from '@/state/ui';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { PanelHeaderProvider } from '@/surface/PanelHeaderSlot';

const GitPanel = lazyNamed(() => import('@/shell/panels/GitPanel'), 'GitPanel');
const ProblemsPanel = lazyNamed(() => import('@/language/ProblemsPanel'), 'ProblemsPanel');
const LaunchesPanel = lazyNamed(() => import('@/launches/LaunchesPanel'), 'LaunchesPanel');
const DatabasesPanel = lazyNamed(() => import('@/database/DatabasesPanel'), 'DatabasesPanel');
const OutputPanel = lazyNamed(() => import('@/output/OutputPanel'), 'OutputPanel');
const VoicePanelBody = lazyNamed(() => import('@/voice/VoicePanelBody'), 'VoicePanelBody');

const DEFAULT_WIDTH = 540;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;

const CORE_PANELS: Record<CorePanel['kind'], ComponentType> = {
    files: FilesPanel,
    git: GitPanel,
    processes: ProcessesPanel,
    devices: DevicesPanel,
    launches: LaunchesPanel,
    databases: DatabasesPanel,
    output: OutputPanel,
    problems: ProblemsPanel,
    voice: VoicePanelBody
};

function bodyOf(entry: PanelEntry | undefined): ComponentType | null {
    if (entry === undefined) {
        return null;
    }

    return 'component' in entry ? entry.component : CORE_PANELS[entry.kind];
}

/* Keep the inner column at its stored width while the outer split animates, avoiding content reflow. */
export function Panel() {
    const gap = usePanelGap();
    const { t } = useTranslation('shell');
    const panel = useShownPanel();
    const open = panel.open;
    const [leadingHeaderSlot, setLeadingHeaderSlot] = useState<HTMLElement | null>(null);
    const [titleSignal, setTitleSignal] = useState<HTMLElement | null>(null);
    const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
    const stored = useUi((s) => s.panelWidth);
    const planOpen = useUi((s) => s.planOpen);
    const entry = usePanelEntries().find((candidate) => candidate.kind === panel.kind);
    const Body = bodyOf(entry);
    const bounds = { min: entry?.minWidth ?? 240, max: () => window.innerWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnSize(bounds, stored ?? DEFAULT_WIDTH);

    const instant = useInstantWidth();

    const label = entry === undefined ? t('panel.fallback') : 'label' in entry ? entry.label() : t(`panel.names.${entry.kind}`);

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
                            kbd={CANVAS_SHORTCUTS.togglePanel}
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
