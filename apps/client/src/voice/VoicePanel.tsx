import { Suspense } from 'react';
import { SlidingColumn } from '@/shell/SlidingColumn';
import { clampColumnSize } from '@/shell/useColumnResize';
import { lazyNamed } from '@/ui/lazy';
import { useVoice } from '@/voice/state';

const VoicePanelBody = lazyNamed(() => import('@/voice/VoicePanelBody'), 'VoicePanelBody');

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
const MIN_WORKSPACE_WIDTH = 480;

/* The column is here and its contents load on the first opening, so the column slides in while they arrive. */
export function VoicePanel() {
    const open = useVoice((state) => state.open);
    const storedWidth = useVoice((state) => state.width);
    const width = clampColumnSize({ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }, storedWidth ?? DEFAULT_WIDTH);

    return (
        <SlidingColumn
            open={open}
            restoreWithProject={false}
            width={width}
            bounds={{ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }}
            onWidth={(next) => useVoice.getState().setWidth(next)}
        >
            <Suspense fallback={null}>
                <VoicePanelBody />
            </Suspense>
        </SlidingColumn>
    );
}
