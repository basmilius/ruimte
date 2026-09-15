import {
    MachineIconSchema,
    deviceLinkStartMessage,
    machineRegistrationMessage,
    type DeviceLinkStartPayload,
    type RegisterMachinePayload
} from '@ruimte/pulsar';
import type { EndpointIdentity } from '../endpoint-id.ts';

type SigningIdentity = Pick<EndpointIdentity, 'id' | 'publicKey' | 'label' | 'icon' | 'sign'>;

/*
 * What the machine tells the address book about itself. The name is signed as the machine calls itself,
 * cut to what the address book stores; the icon and the broker travel unsigned.
 */
const describe = (identity: SigningIdentity) => {
    const icon = MachineIconSchema.safeParse(identity.icon);
    return { id: identity.id, name: identity.label.slice(0, 80), icon: icon.success ? icon.data : null, publicKey: identity.publicKey };
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
