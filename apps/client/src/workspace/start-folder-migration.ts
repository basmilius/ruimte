import type { EndpointInfo } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useSettings } from '@/state/settings';
import { machineAnswers } from '@/transport/features';

let moving = false;

function clearSetting(): void {
    useSettings.getState().update({ browseStartFolder: '' });
}

/*
 * The start folder used to be one setting of this client for every machine; it is the machine's now. A
 * client with a local machine hands its old value to that machine once, unless the machine already
 * has one, and then lets go of it. A machine that cannot take it keeps the setting until one can,
 * and a failed request tries again on the next connect. A client with no local machine has nowhere to
 * send it, so the value goes without being sent.
 */
export async function moveBrowseStartFolder(
    endpointId: string,
    info: Pick<EndpointInfo, 'startFolder' | 'features'>,
    send: (folder: string) => Promise<unknown>
): Promise<void> {
    const old = useSettings.getState().browseStartFolder;

    if (old === '' || moving) {
        return;
    }

    if (!hasLocalMachine()) {
        clearSetting();

        return;
    }

    if (endpointId !== LOCAL_ENDPOINT_ID) {
        return;
    }

    const folder = old.trim();

    if ((info.startFolder ?? '') !== '' || folder === '') {
        clearSetting();

        return;
    }

    if (!machineAnswers(info, 'endpoint.setStartFolder')) {
        return;
    }

    moving = true;

    try {
        await send(folder);
        clearSetting();
    } catch {
        // Stays set; the next connect tries again.
    } finally {
        moving = false;
    }
}
