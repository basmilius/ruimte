import type { ExtensionUiSource } from '../extensions/ui-sources.ts';
import { uiToolkit } from '../tools/ui-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The UI sources extensions supply, asked of them again for each list; absent on a host without extensions. */
        uiSources?: { refresh(start: boolean): Promise<ExtensionUiSource[]> };
    }
}

export const uiFeature = defineAgentFeature({
    name: 'ui',
    toolkit: uiToolkit,
    host: ({ later }) => ({ uiSources: { refresh: (start) => later.extensions().uiSources.refresh(start) } })
});
