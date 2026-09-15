import type { z } from 'zod';
import {
    ADDRESS_BOOK_URL,
    AccessStatementSchema,
    AccountResultSchema,
    AddressBookErrorSchema,
    IdentityLinkStartResultSchema,
    MachineListResultSchema,
    ProvidersResultSchema,
    RegisterMachineResultSchema,
    SessionResultSchema,
    type AccessRequestPayload,
    type AccessStatement,
    type AccountResult,
    type AddressBookErrorCode,
    type IdentityLinkCompletePayload,
    type IdentityLinkStartPayload,
    type IdentityLinkStartResult,
    type ProviderId,
    type Machine,
    type MachineListResult,
    type RegisterMachinePayload,
    type SessionExchangePayload,
    type SessionRefreshPayload,
    type SessionResult
} from './address-book.ts';
import {
    DeviceLinkCompleteResultSchema,
    DeviceLinkLookupResultSchema,
    DeviceLinkPollResultSchema,
    DeviceLinkStartResultSchema,
    type DeviceCodePayload,
    type DeviceLinkCompletePayload,
    type DeviceLinkCompleteResult,
    type DeviceLinkLookupResult,
    type DeviceLinkPollResult,
    type DeviceLinkStartPayload,
    type DeviceLinkStartResult,
    type UserCodePayload
} from './device-link.ts';

/* `network` is no answer at all; `bad-answer` is an answer this client cannot read. */
export type AddressBookFailure = AddressBookErrorCode | 'network' | 'bad-answer';

export class AddressBookRequestError extends Error {
    readonly code: AddressBookFailure;
    readonly status: number;

    constructor(code: AddressBookFailure, status: number, message: string) {
        super(message);
        this.name = 'AddressBookRequestError';
        this.code = code;
        this.status = status;
    }
}

export interface AddressBookClientOptions {
    baseUrl?: string;
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

interface Call<T> {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    token?: string;
    body?: unknown;
    schema: z.ZodType<T> | null;
}

/*
 * The address book's HTTP API as calls, for every side that talks to it: the desktop shell, the
 * client page and later the mobile app. No DOM and no storage in here; a caller decides where a token
 * lives. Every answer is checked against its schema, so a caller never holds a shape it did not expect.
 */
export class AddressBookClient {
    readonly baseUrl: string;
    private readonly fetch: (input: string, init: RequestInit) => Promise<Response>;

    constructor(options: AddressBookClientOptions = {}) {
        this.baseUrl = (options.baseUrl ?? ADDRESS_BOOK_URL).replace(/\/+$/, '');
        this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    }

    exchange(payload: SessionExchangePayload): Promise<SessionResult> {
        return this.call({ method: 'POST', path: '/v1/session', body: payload, schema: SessionResultSchema });
    }

    refresh(payload: SessionRefreshPayload): Promise<SessionResult> {
        return this.call({ method: 'POST', path: '/v1/session/refresh', body: payload, schema: SessionResultSchema });
    }

    async endSession(accessToken: string): Promise<void> {
        await this.call({ method: 'DELETE', path: '/v1/session', token: accessToken, schema: null });
    }

    listMachines(accessToken: string): Promise<MachineListResult> {
        return this.call({ method: 'GET', path: '/v1/machines', token: accessToken, schema: MachineListResultSchema });
    }

    async registerMachine(accessToken: string, payload: RegisterMachinePayload): Promise<Machine> {
        return (await this.call({ method: 'POST', path: '/v1/machines', token: accessToken, body: payload, schema: RegisterMachineResultSchema })).machine;
    }

    async deleteMachine(accessToken: string, machineId: string): Promise<void> {
        await this.call({ method: 'DELETE', path: `/v1/machines/${encodeURIComponent(machineId)}`, token: accessToken, schema: null });
    }

    async providers(): Promise<string[]> {
        return (await this.call({ method: 'GET', path: '/v1/providers', schema: ProvidersResultSchema })).providers;
    }

    account(accessToken: string): Promise<AccountResult> {
        return this.call({ method: 'GET', path: '/v1/account', token: accessToken, schema: AccountResultSchema });
    }

    startIdentityLink(accessToken: string, payload: IdentityLinkStartPayload): Promise<IdentityLinkStartResult> {
        return this.call({ method: 'POST', path: '/v1/account/link', token: accessToken, body: payload, schema: IdentityLinkStartResultSchema });
    }

    completeIdentityLink(accessToken: string, payload: IdentityLinkCompletePayload): Promise<AccountResult> {
        return this.call({ method: 'POST', path: '/v1/account/identities', token: accessToken, body: payload, schema: AccountResultSchema });
    }

    unlinkIdentity(accessToken: string, provider: ProviderId): Promise<AccountResult> {
        return this.call({ method: 'DELETE', path: `/v1/account/identities/${provider}`, token: accessToken, schema: AccountResultSchema });
    }

    requestStatement(accessToken: string, payload: AccessRequestPayload): Promise<AccessStatement> {
        return this.call({ method: 'POST', path: '/v1/statements', token: accessToken, body: payload, schema: AccessStatementSchema });
    }

    startDeviceLink(payload: DeviceLinkStartPayload): Promise<DeviceLinkStartResult> {
        return this.call({ method: 'POST', path: '/v1/device/start', body: payload, schema: DeviceLinkStartResultSchema });
    }

    pollDeviceLink(payload: DeviceCodePayload): Promise<DeviceLinkPollResult> {
        return this.call({ method: 'POST', path: '/v1/device/poll', body: payload, schema: DeviceLinkPollResultSchema });
    }

    completeDeviceLink(payload: DeviceLinkCompletePayload): Promise<DeviceLinkCompleteResult> {
        return this.call({ method: 'POST', path: '/v1/device/complete', body: payload, schema: DeviceLinkCompleteResultSchema });
    }

    async cancelDeviceLink(payload: DeviceCodePayload): Promise<void> {
        await this.call({ method: 'POST', path: '/v1/device/cancel', body: payload, schema: null });
    }

    lookupDeviceLink(accessToken: string, payload: UserCodePayload): Promise<DeviceLinkLookupResult> {
        return this.call({ method: 'POST', path: '/v1/device/lookup', token: accessToken, body: payload, schema: DeviceLinkLookupResultSchema });
    }

    approveDeviceLink(accessToken: string, payload: UserCodePayload): Promise<DeviceLinkLookupResult> {
        return this.call({ method: 'POST', path: '/v1/device/approve', token: accessToken, body: payload, schema: DeviceLinkLookupResultSchema });
    }

    async denyDeviceLink(accessToken: string, payload: UserCodePayload): Promise<void> {
        await this.call({ method: 'POST', path: '/v1/device/deny', token: accessToken, body: payload, schema: null });
    }

    private async call<T>(call: Call<T>): Promise<T> {
        const headers: Record<string, string> = {};
        if (call.token !== undefined) {
            headers.authorization = `Bearer ${call.token}`;
        }
        if (call.body !== undefined) {
            headers['content-type'] = 'application/json';
        }
        let response: Response;
        try {
            response = await this.fetch(`${this.baseUrl}${call.path}`, {
                method: call.method,
                headers,
                body: call.body === undefined ? undefined : JSON.stringify(call.body)
            });
        } catch (e) {
            throw new AddressBookRequestError('network', 0, `The address book could not be reached: ${e instanceof Error ? e.message : String(e)}`);
        }
        const text = await response.text().catch(() => '');
        if (!response.ok) {
            const parsed = AddressBookErrorSchema.safeParse(safeJson(text));
            throw parsed.success
                ? new AddressBookRequestError(parsed.data.error.code, response.status, parsed.data.error.message)
                : new AddressBookRequestError('bad-answer', response.status, `The address book answered ${response.status}`);
        }
        if (call.schema === null) {
            return undefined as T;
        }
        const parsed = call.schema.safeParse(safeJson(text));
        if (!parsed.success) {
            throw new AddressBookRequestError('bad-answer', response.status, 'The address book answered with something this client cannot read');
        }
        return parsed.data;
    }
}

const safeJson = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};
