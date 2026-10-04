import { DESKTOP_APP_SCHEME } from '@ruimte/contracts';
import { protocol } from 'electron';
import { answerAppRequest } from './app-files';

/*
 * Has to run before the app is ready. Standard and secure give the page a real origin and a secure
 * context (WebCrypto signs with the client's key there), fetch and CORS let it talk to the daemon on
 * loopback, streaming serves the big chunks, and service workers carry a video over a direct channel.
 */
export const registerAppScheme = (): void => {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: DESKTOP_APP_SCHEME,
            privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true, allowServiceWorkers: true }
        }
    ]);
};

/* Serves the built client in `root` on the app's own scheme, so the page never waits on a daemon to exist. */
export const serveAppScheme = (root: string): void => {
    protocol.handle(DESKTOP_APP_SCHEME, (request) => answerAppRequest(root, request.url));
};
