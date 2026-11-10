import { defineBehaviors } from '@/commands/behavior';
import { useUi } from '@/state/ui';

export const DEVICE_BEHAVIORS = defineBehaviors({
    'panel-devices': { run: () => useUi.getState().togglePanel('devices') }
});
