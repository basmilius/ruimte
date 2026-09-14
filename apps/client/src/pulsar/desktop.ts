import { z } from 'zod';
import { desktop } from '@/desktop/bridge';
import type { LoginRedirect } from './login';
import { RestoredSessionSchema, SessionViewSchema, type SessionKeeper } from './session';

const LoginCallbackSchema = z.object({ code: z.string().nullable(), state: z.string().nullable(), error: z.string().nullable() });

/* What a login needs from the platform it runs on. */
export interface PulsarPlatform {
    redirect: LoginRedirect;
    keeper: SessionKeeper;
    addressBook(): Promise<string>;
}

/*
 * The desktop shell as that platform: its loopback listener, the system browser, and its vault for the
 * refresh token. Null in a plain browser, which has neither a listener nor a place a page cannot read,
 * so signing in is not offered there. Every answer is parsed, since it crossed a process boundary.
 */
export const desktopPulsar = (): PulsarPlatform | null => {
    const bridge = desktop();
    const pulsar = bridge?.pulsar;
    if (!bridge || !pulsar) {
        return null;
    }
    return {
        addressBook: () => pulsar.addressBook(),
        redirect: {
            listen: () => pulsar.listen(),
            open: (url) => bridge.openExternal(url),
            callback: async () => LoginCallbackSchema.parse(await pulsar.callback()),
            cancel: () => pulsar.cancel()
        },
        keeper: {
            exchange: async (payload) => SessionViewSchema.parse(await pulsar.exchange(payload)),
            refresh: async () => SessionViewSchema.nullable().parse(await pulsar.refresh()),
            restore: async () => RestoredSessionSchema.nullable().parse(await pulsar.restore()),
            signOut: () => pulsar.signOut()
        }
    };
};
