import type { z } from 'zod';
import {
    ADDRESS_BOOK_URL,
    AccessStatementSchema,
    AddressBookErrorSchema,
    MachineListResultSchema,
    RegisterMachineResultSchema,
    SessionResultSchema,
    type AccessRequestPayload,
    type AccessStatement,
    type AddressBookErrorCode,
    type Machine,
    type RegisterMachinePayload,
    type SessionExchangePayload,
    type SessionResult
} from './address-book.ts';

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

    refresh(refreshToken: string): Promise<SessionResult> {
        return this.call({ method: 'POST', path: '/v1/session/refresh', body: { refreshToken }, schema: SessionResultSchema });
    }

    async endSession(accessToken: string): Promise<void> {
        await this.call({ method: 'DELETE', path: '/v1/session', token: accessToken, schema: null });
    }

    async listMachines(accessToken: string): Promise<Machine[]> {
        return (await this.call({ method: 'GET', path: '/v1/machines', token: accessToken, schema: MachineListResultSchema })).machines;
    }

    async registerMachine(accessToken: string, payload: RegisterMachinePayload): Promise<Machine> {
        return (await this.call({ method: 'POST', path: '/v1/machines', token: accessToken, body: payload, schema: RegisterMachineResultSchema })).machine;
    }

    async deleteMachine(accessToken: string, machineId: string): Promise<void> {
        await this.call({ method: 'DELETE', path: `/v1/machines/${encodeURIComponent(machineId)}`, token: accessToken, schema: null });
    }

    requestStatement(accessToken: string, payload: AccessRequestPayload): Promise<AccessStatement> {
        return this.call({ method: 'POST', path: '/v1/statements', token: accessToken, body: payload, schema: AccessStatementSchema });
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
