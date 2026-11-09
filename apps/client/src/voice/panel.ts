import { lazyNamed } from '@adecore/ui';
import { Mic } from 'lucide-react';
import type { PanelDefinition } from '@/registry/panels';

/* Voice Control sits beside the palette's button, since it only shows while a key is set. */
export const VOICE_PANEL: PanelDefinition = {
    id: 'voice',
    icon: Mic,
    minWidth: 320,
    toolbar: false,
    group: 'project',
    togglesElsewhere: true,
    component: lazyNamed(() => import('@/voice/VoicePanelBody'), 'VoicePanelBody')
};
