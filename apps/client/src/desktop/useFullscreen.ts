import { useEffect, useState } from 'react';
import { desktop } from '@/desktop/bridge';

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
