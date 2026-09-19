import { RequestError } from '../dispatcher.ts';

export const STREAMING_DISABLED_MESSAGE = 'Browser and device streaming is disabled on this machine';

/**
 * Builds the guard the browser and the device handlers put in front of every verb that drives a
 * stream. Both read the same machine policy, so a page or a device opened before streaming was
 * turned off cannot stay steerable on one side and not the other.
 *
 * @param streamingAllowed Reads the machine policy at the moment of the call, never at register time.
 */
export const streamingGate = (streamingAllowed: () => boolean): (() => void) => {
    return () => {
        if (!streamingAllowed()) {
            throw new RequestError('streaming-disabled', STREAMING_DISABLED_MESSAGE);
        }
    };
};
