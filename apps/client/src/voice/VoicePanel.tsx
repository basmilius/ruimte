import { Suspense } from 'react';
import { clampColumnSize, SlidingColumn, lazyNamed } from '@adecore/ui';
import { useVoice } from '@/voice/state';
import { usePanelGap } from '@/shell/panel-layout';

const VoicePanelBody = lazyNamed(() => import('@/voice/VoicePanelBody'), 'VoicePanelBody');

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
const MIN_WORKSPACE_WIDTH = 480;

/* The column is here and its contents load on the first opening, so the column slides in while they arrive. */
export function VoicePanel() {
    const gap = usePanelGap();
    const open = useVoice((state) => state.open);
    const storedWidth = useVoice((state) => state.width);
    const width = clampColumnSize({ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }, storedWidth ?? DEFAULT_WIDTH);

    return (
        <SlidingColumn
            gap={gap}
            open={open}
            width={width}
            bounds={{ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }}
            onWidthChange={(next) => useVoice.getState().setWidth(next)}
        >
            <Suspense fallback={null}>
                <VoicePanelBody />
            </Suspense>
        </SlidingColumn>
    );
}
