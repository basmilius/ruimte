import { Suspense, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { usePanelGap } from '@/shell/panel-layout';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { PanelHeaderProvider } from '@/shell/PanelHeaderSlot';
import { FilesPanel } from '@/shell/panels/FilesPanel';
import { ProcessesPanel } from '@/shell/panels/ProcessesPanel';
import { DevicesPanel } from '@/shell/panels/DevicesPanel';
import { clampColumnSize, ErrorBoundary, CloseButton, SlidingColumn, lazyNamed, PanelHeader, SectionLabel } from '@adecore/ui';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { useShownPanel, useUi, type PanelKind } from '@/state/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

const GitPanel = lazyNamed(() => import('@/shell/panels/GitPanel'), 'GitPanel');
const ProblemsPanel = lazyNamed(() => import('@/language/ProblemsPanel'), 'ProblemsPanel');
const LaunchesPanel = lazyNamed(() => import('@/launches/LaunchesPanel'), 'LaunchesPanel');
const DatabasesPanel = lazyNamed(() => import('@/database/DatabasesPanel'), 'DatabasesPanel');

const DEFAULT_WIDTH = 540;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;

function PanelBody({ kind }: { kind: PanelKind }) {
    switch (kind) {
        case 'files':
            return <FilesPanel />;
        case 'git':
            return <GitPanel />;
        case 'processes':
            return <ProcessesPanel />;
        case 'devices':
            return <DevicesPanel />;
        case 'launches':
            return <LaunchesPanel />;
        case 'databases':
            return <DatabasesPanel />;
        case 'problems':
            return <ProblemsPanel />;
    }
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
    const entry = PANELS.find((candidate) => candidate.kind === panel.kind);
    const bounds = { min: entry?.minWidth ?? 240, max: () => window.innerWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnSize(bounds, stored ?? DEFAULT_WIDTH);

    const instant = useInstantWidth();

    const label = entry === undefined ? t('panel.fallback') : t(`panel.names.${entry.kind}`);

    return (
        <SlidingColumn open={open} gap={gap} width={width} bounds={bounds} instant={instant} onWidthChange={(next) => useUi.getState().setPanelWidth(next)}>
            {/* An open panel is the rightmost column, so on Windows and Linux the close button
                        would land under the native window controls; the inset keeps their width free. */}
            <PanelHeader className={clsx('app-drag', open && hasOverlayControls() && 'toolbar-overlay-inset')}>
                <div ref={setLeadingHeaderSlot} className="contents" />
                <div ref={setTitleSignal} className="panel-title-signal hidden" />
                <SectionLabel className="panel-title shrink-0">{label}</SectionLabel>
                {/* The panel's own controls, between its name and the close button. */}
                <div ref={setHeaderSlot} className="flex min-w-0 grow items-center gap-2" />
                <CloseButton
                    label={t('panel.close', { name: label })}
                    kbd={CANVAS_SHORTCUTS.togglePanel}
                    onClick={() => useUi.getState().setPanel({ open: false })}
                />
            </PanelHeader>
            <PanelHeaderProvider hosts={{ leading: leadingHeaderSlot, titleSignal, trailing: headerSlot }}>
                <ErrorBoundary label={t('panel.failed')} resetKeys={[panel.kind]} className="min-h-0 grow">
                    <Suspense fallback={<div className="min-h-0 grow" />}>
                        <PanelBody kind={panel.kind} />
                    </Suspense>
                </ErrorBoundary>
            </PanelHeaderProvider>
        </SlidingColumn>
    );
}
