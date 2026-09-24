import { useEffect, useState } from 'react';
import { TRAFFIC_LIGHTS_INSET_PX, desktop, hasTrafficLights } from '@/desktop/bridge';

/* Whether the desktop window is fullscreen; false in a browser tab. */
export const useDesktopFullscreen = (): boolean => {
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        const bridge = desktop();
        if (!bridge) {
            return;
        }
        void bridge.isFullscreen().then(setFullscreen);
        return bridge.onFullscreen(setFullscreen);
    }, []);
    return fullscreen;
};

/* The padding the strip starts with where there are no traffic lights to clear. */
export const STRIP_PADDING_PX = 12;

/* The space the leftmost strip keeps free for the traffic lights, or nothing where there are none.
   Fullscreen hides them, so the inset goes with them and the strip starts at its own padding. */
export const useTrafficLightInset = (): number | undefined => {
    const fullscreen = useDesktopFullscreen();
    return hasTrafficLights() && !fullscreen ? TRAFFIC_LIGHTS_INSET_PX : undefined;
};
