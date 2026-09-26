import { Suspense, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { PanelHeaderProvider } from '@/shell/PanelHeaderSlot';
import { FilesPanel } from '@/shell/panels/FilesPanel';
import { ProcessesPanel } from '@/shell/panels/ProcessesPanel';
import { DevicesPanel } from '@/shell/panels/DevicesPanel';
import { SlidingColumn } from '@/shell/SlidingColumn';
import { clampColumnSize } from '@/shell/useColumnResize';
import { useUi, type PanelKind } from '@/state/ui';
import { PANEL_HEADER, SECTION_LABEL } from '@ruimte/ui/classes';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { lazyNamed } from '@/ui/lazy';
import { CloseButton } from '@ruimte/ui/CloseButton';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

const GitPanel = lazyNamed(() => import('@/shell/panels/GitPanel'), 'GitPanel');

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
    }
}

/* Keep the inner column at its stored width while the outer split animates, avoiding content reflow. */
export function Panel() {
    const { t } = useTranslation('shell');
    const panel = useUi((s) => s.panel);
    const open = panel.open;
    const [leadingHeaderSlot, setLeadingHeaderSlot] = useState<HTMLElement | null>(null);
    const [titleSignal, setTitleSignal] = useState<HTMLElement | null>(null);
    const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
    const stored = useUi((s) => s.panelWidth);
    const entry = PANELS.find((candidate) => candidate.kind === panel.kind);
    const bounds = { min: entry?.minWidth ?? 240, max: () => window.innerWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnSize(bounds, stored ?? DEFAULT_WIDTH);

    const label = entry === undefined ? t('panel.fallback') : t(`panel.names.${entry.kind}`);

    return (
        <SlidingColumn open={open} width={width} bounds={bounds} onWidth={(next) => useUi.getState().setPanelWidth(next)}>
            {/* An open panel is the rightmost column, so on Windows and Linux the close button
                        would land under the native window controls; the inset keeps their width free. */}
            <header className={clsx(PANEL_HEADER, 'app-drag', open && hasOverlayControls() && 'toolbar-overlay-inset')}>
                <div ref={setLeadingHeaderSlot} className="contents" />
                <div ref={setTitleSignal} className="panel-title-signal hidden" />
                <span className={`${SECTION_LABEL} panel-title shrink-0`}>{label}</span>
                {/* The panel's own controls, between its name and the close button. */}
                <div ref={setHeaderSlot} className="flex min-w-0 grow items-center gap-2" />
                <CloseButton
                    label={t('panel.close', { name: label })}
                    kbd={CANVAS_SHORTCUTS.togglePanel}
                    onClick={() => useUi.getState().setPanel({ open: false })}
                />
            </header>
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
