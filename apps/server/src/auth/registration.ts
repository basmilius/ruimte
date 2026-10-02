import {
    MachineIconSchema,
    deviceLinkStartMessage,
    machineRegistrationMessage,
    type DeviceLinkStartPayload,
    type RegisterMachinePayload
} from '@ruimte/pulsar';
import { clipText } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { AccountChange } from './auth-store.ts';

type SigningIdentity = Pick<EndpointIdentity, 'id' | 'publicKey' | 'label' | 'icon' | 'sign'>;

/*
 * What the machine tells the address book about itself. The name is signed as the machine calls itself,
 * cut to what the address book stores; the icon and the broker travel unsigned.
 */
const describe = (identity: SigningIdentity) => {
    const icon = MachineIconSchema.safeParse(identity.icon);
    return { id: identity.id, name: clipText(identity.label, 80), icon: icon.success ? icon.data : null, publicKey: identity.publicKey };
};

/* The machine agreeing to be listed on one account: `endpoint.signRegistration`, and the last step of `ruimte login`. */
export const signRegistration = (identity: SigningIdentity, brokerUrl: string | null, accountId: string, issuedAt = Date.now()): RegisterMachinePayload => {
    const machine = describe(identity);
    return {
        ...machine,
        brokerUrl,
        issuedAt,
        signature: identity.sign(machineRegistrationMessage(accountId, machine.id, machine.publicKey, machine.name, issuedAt))
    };
};

/* The first step of `ruimte login`: proof of the key the approval page shows, for no account in particular. */
export const signLinkRequest = (identity: SigningIdentity, brokerUrl: string | null, issuedAt = Date.now()): DeviceLinkStartPayload => {
    const machine = describe(identity);
    return {
        ...machine,
        brokerUrl,
        issuedAt,
        signature: identity.sign(deviceLinkStartMessage(machine.id, machine.publicKey, machine.name, issuedAt))
    };
};

export class MachineAccountError extends CodedError<'machine-has-account'> {}

/*
 * The machine agreeing to join one account, which puts it on that account before it signs: a signature
 * handed out is a registration anyone holding it can post. The account it is on already signs again;
 * another one is refused until a person on the machine takes it off. Callers let only the local secret
 * this far, since a paired client could otherwise move the machine to an account of its choosing.
 */
export const signForAccount = async (
    store: { bindAccount(accountId: string): Promise<AccountChange> },
    identity: SigningIdentity,
    brokerUrl: string | null,
    accountId: string,
    // Closes what a client another account let in still has open.
    disconnect: (sessionId: string) => void
): Promise<RegisterMachinePayload> => {
    const change = await store.bindAccount(accountId);
    if (!change.bound) {
        throw new MachineAccountError('machine-has-account', 'This machine is on another account. Take it off that account on this machine first.');
    }
    change.revoked.forEach(disconnect);
    return signRegistration(identity, brokerUrl, accountId);
};
