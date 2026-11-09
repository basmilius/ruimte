import { HostDialogs, HostOverlays } from '@/extensions/host/host-dialogs';
import { Toasts } from '@/shell/Toasts';

/* The toasts and what an extension opens over the window, mounted as one surface among the window's dialogs. */
export function ToastLayer() {
    return (
        <>
            <Toasts />
            <HostDialogs />
            <HostOverlays />
        </>
    );
}
