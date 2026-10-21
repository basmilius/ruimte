import { createCipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, sign } from 'node:crypto';
import {
    CameraSchema,
    CanvasNodeSchema,
    NodeKindSchema,
    PROJECT_ICON_NAMES,
    PROJECT_VIEW_KINDS,
    ProjectIconNameSchema,
    ProjectViewSchema,
    ProjectCanvasViewSchema
} from '../src/project.ts';
import { REQUEST_SCHEMAS, EVENT_SCHEMAS } from '../src/index.ts';
import { RuntimeModeSchema } from '../src/model.ts';
import { MachineUpdateStatusSchema } from '../src/machine-update.ts';
import { PushNotifyKindSchema } from '../src/push.ts';
import { BYTES_CHUNK_MAX, BYTES_READ_MAX_BYTES, BYTES_REPLY_KIND, BYTES_REPLY_MAX_BYTES, CHAT_MODEL_MAX_BYTES } from '../src/bytes.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import * as address from '../../pulsar/src/address-book.ts';
import * as broker from '../../pulsar/src/broker.ts';
import * as push from '../../pulsar/src/push.ts';
import * as signaling from '../../pulsar/src/signaling.ts';
import * as direct from '../src/direct.ts';
import * as server from '../src/server.ts';
import { PairPayloadSchema, PairResultSchema } from '../src/auth.ts';
import * as envelope from '../src/envelope.ts';
import * as signing from '../../pulsar/src/signing.ts';
import * as liveness from '../src/direct-liveness.ts';
import * as agent from '../src/agent.ts';
import { UsageProviderSchema } from '@adecore/agent-contracts';
import * as task from '../src/task.ts';
import * as plan from '@adecore/plan/protocol';
import * as chat from '../src/chat.ts';
import { PLAN_STATE_MARKERS } from '@adecore/plan';
import { PROTOCOL_VERSION } from '../src/protocol.ts';
import { PULSAR_STATEMENT_PUBLIC_KEYS } from '../../pulsar/src/statement-key.ts';

type Schema = Record<string, any>;
const roots: Record<string, z.ZodType> = {};
for (const module of [address, broker, signaling, direct, server, envelope, push]) {
    for (const [name, value] of Object.entries(module)) {
        if (name.endsWith('Schema') && value instanceof z.ZodType && name !== 'LoginStartQuerySchema') {
            roots[name] = value;
        }
    }
}
/*
 * The closed vocabularies of the daemon's own domain, so a Swift switch over one stops compiling when
 * a case is added instead of falling into a default. Their object schemas stay out: a plan step holds
 * its own sub-steps, so its JSON Schema carries a `$ref` this generator does not resolve, and the app
 * reads those shapes through the dynamic `WireSchema` tables anyway.
 */
const vocabularies: Record<string, z.ZodType> = {};
// Open on the wire, so its Swift enum holds the kinds this version knows by name and a newer one decodes as nil.
const KnownAgentKindSchema = z.enum(agent.KNOWN_AGENT_KINDS);
for (const module of [agent, task, plan, chat]) {
    for (const [name, rawValue] of Object.entries(module)) {
        const value = rawValue === agent.AgentKindSchema ? KnownAgentKindSchema : rawValue;
        if (name.endsWith('Schema') && value instanceof z.ZodEnum) {
            vocabularies[name] = value;
            roots[name] = value;
        }
    }
}
roots.PairPayloadSchema = PairPayloadSchema;
roots.PairResultSchema = PairResultSchema;
roots.ProjectCanvasDefaultsSchema = ProjectCanvasViewSchema.pick({ layouts: true });
const schemas: Record<string, Schema> = {};
for (const [name, schema] of Object.entries(roots)) {
    schemas[name] = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' });
}
// JSON Schema cannot carry Zod refinements; retain the statement lifetime check explicitly.
function stampStatement(schema: Schema): void {
    if (schema.type === 'object' && schema.properties?.machineId && schema.properties?.clientPublicKey && schema.properties?.expiresAt) {
        schema['x-statement-lifetime-ms'] = address.ACCESS_STATEMENT_LIFETIME_MS;
    }
    for (const value of Object.values(schema)) {
        if (Array.isArray(value)) {
            value.forEach((child) => {
                if (child && typeof child === 'object') {
                    stampStatement(child);
                }
            });
        } else if (value && typeof value === 'object') {
            stampStatement(value);
        }
    }
}
Object.values(schemas).forEach(stampStatement);
function canonical(schema: Schema): string {
    return JSON.stringify(schema, (key, value) => (key === '$schema' ? undefined : value));
}
const names = new Map(
    Object.entries(schemas).map(([name, schema]) => [canonical(schema), name.replace(/Schema$/, '') === 'Error' ? 'WireError' : name.replace(/Schema$/, '')])
);
const declarations = new Map<string, string>();
// Off for the typed hot paths, which the client validated as a whole frame before anything decodes them.
let validatingStructs = true;
function camel(name: string): string {
    return name.replace(/[-. ]+(\w)/g, (_match, letter) => letter.toUpperCase());
}
function identifier(name: string): string {
    return `\`${camel(name)}\``;
}
function nullable(schema: Schema): Schema | undefined {
    return Array.isArray(schema.type) && schema.type.includes('null')
        ? { ...schema, type: schema.type.find((type: string) => type !== 'null') }
        : schema.anyOf?.length === 2 && schema.anyOf.some((entry: Schema) => entry.type === 'null')
          ? schema.anyOf.find((entry: Schema) => entry.type !== 'null')
          : undefined;
}
function typeOf(schema: Schema, suggested: string, force = false): string {
    const inner = nullable(schema);
    if (inner) {
        return `${typeOf(inner, suggested)}?`;
    }
    const named = names.get(canonical(schema));
    const name = named ?? suggested;
    if (named && !force && declarations.has(name)) {
        return name;
    }
    if (schema.enum) {
        declarations.set(
            name,
            `public enum ${name}: String, CaseIterable, Codable, Sendable, Equatable {\n${schema.enum.map((value: string) => `    case ${identifier(value)} = ${JSON.stringify(value)}`).join('\n')}\n}`
        );
        return name;
    }
    if (schema.type === 'object') {
        if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
            return `[String: ${typeOf(schema.additionalProperties, name + 'Value')}]`;
        }
        if (declarations.has(name)) {
            return name;
        }
        declarations.set(name, '');
        const properties = Object.entries(schema.properties ?? {}).map(([key, child]) => {
            const value = child as Schema;
            const optional = !schema.required?.includes(key) && value.default === undefined;
            const isNullable = !!nullable(value);
            const base = typeOf(nullable(value) ?? value, name + key.charAt(0).toUpperCase() + key.slice(1));
            const type = optional && isNullable ? `Presence<${base}>` : optional || isNullable ? `${base}?` : base;
            return { key, value, optional, isNullable, base, type };
        });
        const schemaName = validatingStructs ? Object.entries(schemas).find(([, value]) => canonical(value) === canonical(schema))?.[0] : undefined;
        const fields = properties.map(({ key, type }) => `    public let ${identifier(key)}: ${type}`).join('\n');
        const parameters = properties
            .map(
                ({ key, type, value, optional, isNullable }) =>
                    `${identifier(key)}: ${type}${optional ? (isNullable ? ' = .missing' : ' = nil') : value.const !== undefined ? ` = ${JSON.stringify(value.const)}` : ''}`
            )
            .join(', ');
        const assignment = properties.map(({ key }) => `        self.${identifier(key)} = ${identifier(key)}`).join('\n');
        const decoding = properties
            .map(({ key, value, optional, isNullable, base, type }) => {
                const expression =
                    value.default !== undefined
                        ? `try container.decodeIfPresent(${base}.self, forKey: .${identifier(key)}) ?? ${JSON.stringify(value.default)}`
                        : optional && isNullable
                          ? `try container.contains(.${identifier(key)}) ? (container.decodeNil(forKey: .${identifier(key)}) ? .null : .value(container.decode(${base}.self, forKey: .${identifier(key)}))) : .missing`
                          : optional
                            ? `try container.decodeIfPresent(${base}.self, forKey: .${identifier(key)})`
                            : `try container.decode(${type}.self, forKey: .${identifier(key)})`;
                return `        ${identifier(key)} = ${expression}`;
            })
            .join('\n');
        const encoding = properties
            .map(({ key, optional, isNullable }) =>
                optional && isNullable
                    ? `        switch ${identifier(key)} {\n        case .missing: break\n        case .null: try container.encodeNil(forKey: .${identifier(key)})\n        case .value(let value): try container.encode(value, forKey: .${identifier(key)})\n        }`
                    : `        try container.${optional ? 'encodeIfPresent' : 'encode'}(${identifier(key)}, forKey: .${identifier(key)})`
            )
            .join('\n');
        declarations.set(
            name,
            `public struct ${name}: Codable, Sendable, Equatable {\n${fields}\n\n    public init(${parameters}) {\n${assignment}\n    }\n\n    public init(from decoder: Decoder) throws {\n${schemaName ? `        _ = try WireSchema.validate(${JSON.stringify(schemaName)}, JSONValue(from: decoder))\n` : ''}        ${properties.length ? 'let container' : '_'} = try decoder.container(keyedBy: CodingKeys.self)\n${decoding}\n    }\n\n    public func encode(to encoder: Encoder) throws {\n        ${properties.length ? 'var container' : '_'} = encoder.container(keyedBy: CodingKeys.self)\n${encoding}\n    }\n\n    private enum CodingKeys: String, CodingKey {\n${properties.length ? properties.map(({ key }) => `        case ${identifier(key)} = ${JSON.stringify(key)}`).join('\n') : '        case unused'}\n    }\n}`
        );
        return name;
    }
    const members = schema.oneOf ?? schema.anyOf;
    if (members) {
        if (declarations.has(name)) {
            return name;
        }
        declarations.set(name, '');
        const tag = Object.keys(members[0]?.properties ?? {}).find((key) => members.every((member: Schema) => member.properties?.[key]?.const !== undefined));
        const cases = members.map((member: Schema, index: number) => ({
            type: typeOf(member, `${name}Variant${index}`),
            label: tag ? String(member.properties[tag].const) : `variant${index}`
        }));
        const decoding = tag
            ? `        let container = try decoder.container(keyedBy: Tag.self)\n        switch try container.decode(${typeof members[0].properties[tag].const === 'boolean' ? 'Bool' : 'String'}.self, forKey: .value) {\n${cases.map(({ label, type }: any) => `        case ${JSON.stringify(members[cases.findIndex((entry: any) => entry.label === label)].properties[tag].const)}: self = .${identifier(label)}(try ${type}(from: decoder))`).join('\n')}${typeof members[0].properties[tag].const === 'boolean' && cases.length === 2 ? '' : `\n        default: throw WireValidationError.invalid("Unknown ${name} tag")`}\n        }`
            : `${cases.map(({ label, type }: any) => `        if let value = try? ${type}(from: decoder) { self = .${identifier(label)}(value); return }`).join('\n')}\n        throw WireValidationError.invalid("Invalid ${name}")`;
        declarations.set(
            name,
            `public enum ${name}: Codable, Sendable, Equatable {\n${cases.map(({ label, type }: any) => `    case ${identifier(label)}(${type})`).join('\n')}\n\n    public init(from decoder: Decoder) throws {\n${decoding}\n    }\n\n    public func encode(to encoder: Encoder) throws {\n        switch self {\n${cases.map(({ label }: any) => `        case .${identifier(label)}(let value): try value.encode(to: encoder)`).join('\n')}\n        }\n    }\n${tag ? `\n    private enum Tag: String, CodingKey { case value = ${JSON.stringify(tag)} }\n` : ''}}`
        );
        return name;
    }
    if (schema.type === 'array') {
        return `[${typeOf(schema.items, suggested + 'Item')}]`;
    }
    if (schema.type === 'string' || typeof schema.const === 'string') {
        return 'String';
    }
    if (schema.type === 'integer') {
        return 'Int64';
    }
    if (schema.type === 'number') {
        return 'Double';
    }
    if (schema.type === 'boolean' || typeof schema.const === 'boolean') {
        return 'Bool';
    }
    // A value of more than one primitive type, such as a model option that is a word or a switch.
    if (Object.keys(schema).every((key) => ['$schema', 'default'].includes(key)) || Array.isArray(schema.type)) {
        return 'JSONValue';
    }
    throw new Error(`Unsupported schema ${suggested}: ${JSON.stringify(schema)}`);
}
for (const [name, schema] of Object.entries(schemas)) {
    const clean = name === 'ErrorSchema' ? 'WireError' : name.replace(/Schema$/, '');
    const type = typeOf(schema, clean, true);
    if (type !== clean) {
        declarations.set(clean, `public typealias ${clean} = ${type}`);
    }
}
const INT_CONSTANTS = new Set(['directPieceChars', 'directBinaryPieceBytes', 'bytesReplyKind', 'bytesReplyMaxBytes', 'chatModelMaxBytes']);
const constants = {
    protocolVersion: PROTOCOL_VERSION,
    bytesChunkMax: BYTES_CHUNK_MAX,
    pushMaxAgeMs: push.PUSH_MAX_AGE_MS,
    pushMaxClockSkewMs: push.PUSH_MAX_CLOCK_SKEW_MS,
    pushHKDFSalt: push.PUSH_HKDF_SALT,
    bytesReadMaxBytes: BYTES_READ_MAX_BYTES,
    chatModelMaxBytes: CHAT_MODEL_MAX_BYTES,
    bytesReplyKind: BYTES_REPLY_KIND,
    bytesReplyMaxBytes: BYTES_REPLY_MAX_BYTES,
    directChannelLabel: direct.DIRECT_CHANNEL_LABEL,
    directPieceChars: direct.DIRECT_PIECE_CHARS,
    directBinaryPieceBytes: direct.DIRECT_BINARY_PIECE_BYTES,
    directCompression: direct.DIRECT_COMPRESSION,
    directPingIdleMs: liveness.DIRECT_PING_IDLE_MS,
    directPingTimeoutMs: liveness.DIRECT_PING_TIMEOUT_MS,
    directPingTickMs: liveness.DIRECT_PING_TICK_MS,
    addressBookURL: address.ADDRESS_BOOK_URL,
    appRedirectURI: address.APP_REDIRECT_SCHEME_URI,
    accountDeleteWord: address.ACCOUNT_DELETE_WORD,
    statementPublicKeys: PULSAR_STATEMENT_PUBLIC_KEYS
};
const constantSource = Object.entries(constants)
    .map(
        ([name, value]) =>
            `    public static let ${name}: ${Array.isArray(value) ? '[String]' : typeof value === 'string' ? 'String' : name === 'protocolVersion' ? 'Int64' : INT_CONSTANTS.has(name) ? 'Int' : 'Double'} = ${JSON.stringify(value)}`
    )
    .join('\n');
/*
 * Vocabularies a newer machine may extend without asking this app first. A released app validates whole replies,
 * so one closed literal it never saw would refuse every `chat.list` or `project.open` holding it. On the wire these
 * are any string, and the known words ride along as `x-open-enum` for the app to fall back from.
 */
const openVocabularies: ReadonlyMap<unknown, readonly string[]> = new Map<unknown, readonly string[]>([
    [agent.AgentKindSchema, agent.KNOWN_AGENT_KINDS],
    [agent.AgentStatusSchema, agent.AgentStatusSchema.options],
    [RuntimeModeSchema, RuntimeModeSchema.options],
    [chat.ChatRequestKindSchema, chat.ChatRequestKindSchema.options],
    [MachineUpdateStatusSchema, MachineUpdateStatusSchema.options],
    [PushNotifyKindSchema, PushNotifyKindSchema.options],
    [ProjectIconNameSchema, PROJECT_ICON_NAMES],
    [UsageProviderSchema, UsageProviderSchema.options]
]);
// Keep the complete daemon API dynamic: thousands of nested Swift declarations slow every app build.
const apiRoots: Record<string, z.ZodType> = {};
for (const [name, pair] of Object.entries(REQUEST_SCHEMAS)) {
    apiRoots[`request.${name}.payload`] = pair.payload;
    apiRoots[`request.${name}.result`] = pair.result;
}
for (const [name, schema] of Object.entries(EVENT_SCHEMAS)) {
    apiRoots[`event.${name}`] = schema;
}
for (const [name, schema] of Object.entries(apiRoots)) {
    roots[name] = schema;
    schemas[name] = z.toJSONSchema(schema, {
        io: 'input',
        unrepresentable: 'throw',
        override: ({ zodSchema, jsonSchema }) => {
            const known = openVocabularies.get(zodSchema);
            if (known) {
                jsonSchema['x-open-enum'] = [...known];
                delete jsonSchema.enum;
            }
            if (zodSchema instanceof z.ZodPipe && zodSchema.in === CameraSchema) {
                jsonSchema['x-output-null'] = true;
            }
            if (zodSchema === CanvasNodeSchema || zodSchema === ProjectViewSchema) {
                const isNode = zodSchema === CanvasNodeSchema;
                const raw = { id: 'future-id', kind: 'future-kind' };
                jsonSchema['x-project-entry'] = {
                    knownKinds: isNode ? NodeKindSchema.options : PROJECT_VIEW_KINDS,
                    template: (isNode ? CanvasNodeSchema : ProjectViewSchema).parse(raw),
                    node: isNode
                };
            }
        }
    });
    stampStatement(schemas[name]!);
    if (name === 'request.chat.send.payload') {
        schemas[name]!['x-message-content'] = true;
    }
    if (name === 'request.session.attach.payload') {
        schemas[name]!['x-follow-dimensions'] = true;
    }
}
/*
 * The payloads the app reads on its hot paths become structs, so a renamed field stops the app's build instead of
 * reading as an empty string. They come from the API's own JSON Schemas, open vocabularies included, so a newer
 * machine's word still decodes. A `$ref` only reaches the recursive blocks of an intelligent UI reply, which the app
 * reads as JSON.
 */
function typedSchema(value: unknown): any {
    if (Array.isArray(value)) {
        return value.map(typedSchema);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    if ('$ref' in value) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key !== '$defs' && key !== '$schema')
            .map(([key, child]) => [key, typedSchema(child)])
    );
}
function pascal(word: string): string {
    return camel(word).charAt(0).toUpperCase() + camel(word).slice(1);
}
const typedRoots: [name: string, source: string, path: (string | number)[]][] = [
    ['ChatItem', 'request.chat.attach.result', ['properties', 'items', 'items']],
    ['ChatInfo', 'request.chat.attach.result', ['properties', 'info']],
    ['ChatEvent', 'request.chat.attach.result', ['properties', 'events', 'items']],
    ['ChatHistoryPage', 'request.chat.attach.result', ['properties', 'history']],
    ['ChatAttachResult', 'request.chat.attach.result', []],
    ['ChatHistoryResult', 'request.chat.history.result', []],
    ['ChatEventEnvelope', 'event.chat.event', []],
    ['SessionAgent', 'event.session.status', ['properties', 'agent', 'anyOf', 0]],
    ['SessionStatusEvent', 'event.session.status', []],
    ['GitStatusFile', 'request.git.status.result', ['properties', 'files', 'items']],
    ['GitStatus', 'request.git.status.result', []],
    ['GitStatusEvent', 'event.git.status', []],
    ['ProjectSummary', 'event.project.summary', ['properties', 'summary']]
];
const typed = typedRoots.map(([name, source, path]) => {
    const schema = path.reduce((node: any, key) => node?.[key], typedSchema(schemas[source]));
    if (!schema) {
        throw new Error(`No schema at ${source} ${path.join('.')}`);
    }
    names.set(canonical(schema), name);
    return [name, schema] as const;
});
function typedMembers(union: string, tag: string): Map<string, Schema> {
    const schema = typed.find(([name]) => name === union)![1];
    return new Map((schema.oneOf ?? schema.anyOf).map((member: Schema) => [member.properties[tag].const, member]));
}
// The members of a union are named after their tag: `ChatUserItem`, `ChatDeltaEvent`.
for (const [union, tag, suffix] of [
    ['ChatItem', 'kind', 'Item'],
    ['ChatEvent', 'type', 'Event']
] as const) {
    for (const [value, member] of typedMembers(union, tag)) {
        names.set(canonical(member), `Chat${pascal(value)}${suffix}`);
    }
}
// Named once, so an assistant message and a delta share the shapes of an intelligent UI reply.
const assistant = typedMembers('ChatItem', 'kind').get('assistant')!.properties;
names.set(canonical(assistant.ui.items), 'ChatUiBlock');
names.set(canonical(assistant.uiQueries), 'ChatUiQueryState');
names.set(canonical(assistant.uiAnswers.additionalProperties), 'ChatUiAnswer');
validatingStructs = false;
for (const [name, schema] of typed) {
    const type = typeOf(schema, name);
    if (type !== name) {
        declarations.set(name, `public typealias ${name} = ${type}`);
    }
}
validatingStructs = true;
function tableSource(name: string, entries: string[], methods: string): string {
    return `public enum ${name}: String, CaseIterable, Sendable {\n${entries.map((entry) => `    case ${identifier(entry)} = ${JSON.stringify(entry)}`).join('\n')}\n\n${methods}\n}`;
}
const apiSource = [
    tableSource(
        'WireRequest',
        Object.keys(REQUEST_SCHEMAS),
        `    public func validatePayload(_ value: JSONValue) throws -> JSONValue { try WireSchema.validate("request.\\(rawValue).payload", value) }\n    public func validateResult(_ value: JSONValue) throws -> JSONValue { try WireSchema.validate("request.\\(rawValue).result", value) }`
    ),
    tableSource(
        'WireEvent',
        Object.keys(EVENT_SCHEMAS),
        `    public func validatePayload(_ value: JSONValue) throws -> JSONValue { try WireSchema.validate("event.\\(rawValue)", value) }`
    )
].join('\n\n');
/*
 * The markers of `plan read` and Copy as Markdown. `PLAN_STATE_MARKERS` is keyed on every state, so a
 * new one fails the TypeScript build here before it can reach a Swift switch without a marker.
 */
const planMarkerSource = `public extension PlanStepState {
    /// The marker of this state, as \`PLAN_STATE_MARKERS\` in \`@adecore/plan\` writes it.
    var marker: String {
        switch self {
${plan.PlanStepStateSchema.options.map((state) => `        case .${camel(state)}: ${JSON.stringify(PLAN_STATE_MARKERS[state])}`).join('\n')}
        }
    }
}`;
const root = resolve(import.meta.dir, '../../../apps/ios/Packages/RuimtePulsar');
const outputs = new Map<string, string>([
    [
        'Sources/RuimtePulsar/Generated/DaemonAPI.swift',
        `// Generated by packages/contracts/scripts/generate-swift.ts; edit the TypeScript schemas.\n${apiSource}\n`
    ],
    [
        'Sources/RuimtePulsar/Generated/Models.swift',
        `// Generated by packages/contracts/scripts/generate-swift.ts; edit the TypeScript schemas.\nimport Foundation\n\npublic enum WireConstants {\n${constantSource}\n}\n\n${[...declarations.values()].join('\n\n')}\n\n${planMarkerSource}\n`
    ],
    ['Sources/RuimtePulsar/Generated/schemas.json', JSON.stringify(schemas, null, 2) + '\n']
]);
const key = 'A'.repeat(43);
const nonce = 'n'.repeat(24);
const statement = { machineId: 'machine-1', clientPublicKey: key, nonce, issuedAt: 1000, expiresAt: 121000, signature: 'S'.repeat(86) };
const offer = {
    connectionId: 'attempt_1',
    signal: { kind: 'offer' as const, sdp: 'v=0\r\na=fingerprint:sha-256 aa:BB\r\n', access: { statement, label: 'Bás 📱 漢字 / "ruimte"\n' } }
};
const signatureFixtures = [
    {
        kind: 'sessionKey',
        args: ['Unicode 📱 / \b\f\n\r\t\u0000\u2028\u2029', key],
        expected: signing.sessionKeyMessage('Unicode 📱 / \b\f\n\r\t\u0000\u2028\u2029', key)
    },
    { kind: 'sessionKey', args: [key, key], expected: signing.sessionKeyMessage(key, key) },
    { kind: 'sessionRefresh', args: [key, 1789488000123], expected: signing.sessionRefreshMessage(key, 1789488000123) },
    { kind: 'accessRequest', args: ['machine-1', key, nonce], expected: signing.accessRequestMessage('machine-1', key, nonce) },
    { kind: 'brokerHello', args: ['broker.ruimte.app', 'client', key, nonce], expected: signing.brokerHelloMessage('broker.ruimte.app', 'client', key, nonce) },
    { kind: 'signal', args: [key, key, offer], expected: signing.signalMessage(key, key, offer) },
    {
        kind: 'signal',
        args: [key, key, { connectionId: 'attempt_2', signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null } }],
        expected: signing.signalMessage(key, key, {
            connectionId: 'attempt_2',
            signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null }
        })
    }
];
const framingFixtures = ['hello', 'A'.repeat(15999) + '📱' + '終', 'e\u0301'.repeat(9000), ''].map((input) => ({ input, pieces: direct.splitFrame(input) }));
const validationInputs: { schema: string; input: unknown }[] = [
    { schema: 'PairPayloadSchema', input: { token: 'one-use', label: 'iPhone', publicKey: key } },
    { schema: 'PairPayloadSchema', input: { token: '', label: 'iPhone' } },
    {
        schema: 'PairResultSchema',
        input: {
            endpoint: {
                id: 'machine-1',
                label: 'Mac',
                platform: 'darwin',
                version: '1.0',
                protocol: PROTOCOL_VERSION,
                reachability: 'public',
                authenticated: true
            }
        }
    },
    { schema: 'PairResultSchema', input: { endpoint: { id: 'machine-1' } } },
    ...[0, -1, 1].map((width) => ({
        schema: 'ProjectCanvasDefaultsSchema',
        input: { layouts: [{ name: 'Canvas', nodes: { node: { x: 0, y: 0, w: width, h: 1 } }, texts: {} }] }
    })),
    { schema: 'ProjectCanvasDefaultsSchema', input: {} },
    { schema: 'ProjectCanvasDefaultsSchema', input: { layouts: null } },
    { schema: 'AccountSchema', input: { id: 'account', provider: 'github', login: null } },
    { schema: 'AccountSchema', input: { id: 'account', provider: 'github' } },
    { schema: 'ServerHelloResultSchema', input: { version: '1', platform: 'darwin', home: '/Users/bas' } },
    { schema: 'ServerHelloResultSchema', input: { version: '1', platform: 'darwin', home: '/Users/bas', model: null } },
    { schema: 'SignalEnvelopeSchema', input: offer },
    { schema: 'AccessStatementSchema', input: { ...statement, expiresAt: 121001 } },
    { schema: 'RegisterMachinePayloadSchema', input: { id: 'machine-1', name: 'Mac', icon: null, publicKey: key, issuedAt: 0, signature: 'S'.repeat(86) } },
    {
        schema: 'RegisterMachinePayloadSchema',
        input: { id: 'machine-1', name: 'Mac', icon: null, brokerUrl: null, publicKey: key, issuedAt: 0, signature: 'S'.repeat(86) }
    }
];
// A stored node, text, layout and view keep a key this version does not know, so an iPhone save writes it back.
const keptFieldsContent = {
    name: 'Kept',
    color: '',
    views: [
        {
            id: 'v',
            kind: 'canvas',
            name: 'Canvas',
            futureView: { nested: [null, 42] },
            nodes: [
                { id: 'file', kind: 'file', title: 'File', x: 0, y: 0, w: 320, h: 200, path: 'a.ts', location: { line: 3 } },
                { id: 'chat', kind: 'chat', title: 'Chat', x: 340, y: 0, w: 320, h: 200, machine: 'B' }
            ],
            texts: [{ id: 't', x: 0, y: 240, text: 'Note', size: 16, futureStyle: 'wavy' }],
            edges: [],
            layouts: [
                {
                    name: 'Layout',
                    futureLayout: true,
                    nodes: { file: { x: 0, y: 0, w: 320, h: 200, futureRect: 1 } },
                    texts: { t: { x: 0, y: 240, futureRect: 2 } }
                }
            ]
        },
        { id: 'chat-view', kind: 'chat', name: 'Chat', futureView: 1, node: { futureFlag: true } },
        { id: 'sep', kind: 'separator', futureView: 2 }
    ]
};
validationInputs.push(
    {
        schema: 'request.project.save.payload',
        input: {
            projectId: 'p',
            baseRev: 0,
            content: { name: 'Future', color: '', views: [{ id: 'v', kind: 'future-view', extension: { nested: [null, 42] } }] }
        }
    },
    {
        schema: 'request.project.save.payload',
        input: {
            projectId: 'p',
            baseRev: 0,
            content: {
                name: 'Future',
                color: '',
                views: [
                    {
                        id: 'v',
                        kind: 'canvas',
                        name: 'Canvas',
                        nodes: [{ id: 'n', kind: 'future-node', extension: { nested: [null, 42] } }],
                        texts: [],
                        edges: []
                    }
                ]
            }
        }
    },
    { schema: 'request.project.save.payload', input: { projectId: 'p', baseRev: 3, content: keptFieldsContent } },
    { schema: 'event.project.changed', input: { projectId: 'p', document: { ...keptFieldsContent, version: 3, rev: 4 } } },
    { schema: 'request.chat.send.payload', input: { chatId: 'c', text: '' } },
    { schema: 'request.chat.send.payload', input: { chatId: 'c', text: 'Hello' } }
);
// A plan's steps are recursive, so these reach a sub-step through a `$ref`.
for (const state of ['done', 'finished']) {
    validationInputs.push({
        schema: 'event.plan.changed',
        input: {
            chatId: 'c',
            plan: {
                id: 'plan-1',
                rev: 2,
                createdAt: '2026-09-16T13:40:00Z',
                meta: { title: 'Plan', kind: 'test', checks: 'person' },
                items: [
                    {
                        type: 'section',
                        id: 'split',
                        title: 'Split',
                        items: [
                            { type: 'text', id: 'prep', title: 'Before you start' },
                            {
                                type: 'step',
                                id: 'grid',
                                title: 'Grid',
                                future: true,
                                steps: [{ type: 'step', id: 'zone', title: 'Zone', steps: [{ type: 'step', id: 'edge', title: 'Edge', state, by: 'person' }] }]
                            }
                        ]
                    },
                    { type: 'step', id: 'pixels', title: 'Pixels', checks: 'agent', unlocked: true }
                ]
            }
        }
    });
}

for (const payload of [
    { sessionId: 's' },
    { sessionId: 's', follow: true },
    { sessionId: 's', cols: 80 },
    { sessionId: 's', cols: 80, rows: 24 },
    { sessionId: 's', follow: true, cols: 80 }
]) {
    validationInputs.push({ schema: 'request.session.attach.payload', input: payload });
}
for (const pos of [[1, 2], [1], [1, 2, 3], [1, 'two']]) {
    validationInputs.push({
        schema: 'request.diagram.save.payload',
        input: {
            projectId: 'p',
            viewId: 'v',
            baseRev: 0,
            content: { meta: { title: '', direction: 'right' }, nodes: [{ id: 'n', label: 'Node', pos }], groups: [], edges: [] }
        }
    });
}
for (const points of [[[1, 2]], [[1, 2, 0.5]], [[1, 2, 0.5, 1]], [[1, 'two']]]) {
    validationInputs.push({
        schema: 'request.drawing.save.payload',
        input: {
            projectId: 'p',
            viewId: 'v',
            baseRev: 0,
            content: { elements: [{ id: 'e', kind: 'freehand', x: 0, y: 0, w: 1, h: 1, stroke: 'ink', strokeWidth: 1, seed: 0, points }] }
        }
    });
}
validationInputs.push({
    schema: 'request.project.save-local.payload',
    input: {
        projectId: 'p',
        local: {
            activeViewId: null,
            views: { canvas: { camera: { x: 1, y: 2, zoom: 1 }, focusedNodeId: null } },
            panels: { favicons: { n: 'data:image/png;base64,AQ==' } }
        }
    }
});
// The typed hot paths decode these in Swift: every chat item kind and event type once.
const chatInfoFixture = {
    chatId: 'chat-1',
    provider: 'claude',
    cwd: '/work',
    agentSessionId: null,
    model: null,
    selection: { model: 'opus', options: { effort: 'high', thinking: true } },
    runtimeMode: 'auto',
    status: 'needs-you',
    running: true,
    activeTurnId: 'turn-1',
    slashCommands: ['compact'],
    usage: { contextTokens: 1200, contextWindow: null, costUsd: 0.25, turns: 1 },
    createdAt: 1000
};
const turnBase = { createdAt: 1000, turnId: 'turn-1' };
const chatItemsFixture = [
    { ...turnBase, id: 'turn-1', kind: 'turn', state: 'running', endedAt: null, costUsd: 0 },
    { ...turnBase, id: 'user-1', kind: 'user', text: 'Hello 📱', mentions: ['src/app.ts'] },
    { ...turnBase, id: 'thinking-1', kind: 'thinking', text: 'Hm', streaming: false, endedAt: 1001 },
    { ...turnBase, id: 'assistant-1', kind: 'assistant', text: 'Hi', streaming: true, parentToolUseId: null },
    {
        ...turnBase,
        id: 'tool-1',
        kind: 'tool',
        toolUseId: 'use-1',
        name: 'Bash',
        input: { command: 'ls', nested: [1, null] },
        output: null,
        state: 'running',
        parentToolUseId: null
    },
    {
        ...turnBase,
        id: 'subagent-1',
        kind: 'subagent',
        toolUseId: 'use-2',
        description: 'Explore',
        subagentType: null,
        prompt: null,
        background: false,
        status: 'running',
        startedAt: 1000,
        finishedAt: null,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    },
    {
        ...turnBase,
        id: 'approval-1',
        kind: 'approval',
        requestId: 'request-1',
        toolUseId: null,
        toolName: 'Write',
        input: null,
        description: null,
        canAllowAlways: true,
        decision: 'pending'
    },
    {
        ...turnBase,
        id: 'question-1',
        kind: 'question',
        requestId: 'request-2',
        questions: [{ id: 'q', header: 'Pick', question: 'Which?', choices: [{ label: 'A', description: '' }], multiSelect: false }],
        answers: null,
        state: 'pending'
    },
    { ...turnBase, id: 'note-1', kind: 'note', level: 'warning', text: 'Careful' },
    { ...turnBase, turnId: null, id: 'compaction-1', kind: 'compaction', preTokens: 90000 }
];
validationInputs.push(
    {
        schema: 'request.chat.attach.result',
        input: { info: chatInfoFixture, items: chatItemsFixture, history: { start: 0, cursor: 'c1' }, pending: [], seq: 12 }
    },
    {
        schema: 'request.chat.attach.result',
        input: {
            info: chatInfoFixture,
            items: [],
            seq: 14,
            events: [
                { type: 'item', item: chatItemsFixture[3], historyIndex: 4 },
                { type: 'delta', itemId: 'assistant-1', text: ' there' },
                { type: 'info', info: { ...chatInfoFixture, activeTurnId: null } },
                { type: 'reset', info: chatInfoFixture, items: [] }
            ]
        }
    },
    { schema: 'event.chat.event', input: { chatId: 'chat-1', event: { type: 'delta', itemId: 'tool-1', text: 'out' }, seq: 15 } },
    {
        schema: 'event.session.status',
        input: {
            sessionId: 'session-1',
            agent: {
                kind: 'codex',
                agentSessionId: 'agent-1',
                transcriptPath: null,
                status: 'needs-you',
                requests: [{ id: 'r', source: 'hook', kind: 'approval', toolName: 'Bash', title: null, text: 'ls', createdAt: 1000 }],
                live: true,
                updatedAt: 1000
            }
        }
    },
    { schema: 'event.session.status', input: { sessionId: 'session-1', agent: null } },
    {
        schema: 'event.git.status',
        input: {
            cwd: '/work',
            status: {
                repo: true,
                operation: 'merge',
                root: '/work',
                branch: 'main',
                detached: false,
                upstream: 'origin/main',
                ahead: 2,
                behind: 0,
                base: null,
                mergeBase: null,
                files: [{ path: 'b.ts', oldPath: 'a.ts', state: 'staged', status: 'R', added: 3, deleted: 1, binary: false }],
                truncated: false,
                live: true
            }
        }
    },
    {
        schema: 'event.project.summary',
        input: {
            summary: {
                projectId: 'project-1',
                name: 'Ruimte',
                color: 'blue',
                folder: '/work',
                lastOpenedAt: 1000,
                closedAt: null,
                available: true,
                icon: { kind: 'lucide', value: 'box' },
                nameSource: 'folder'
            }
        }
    }
);
const validations = validationInputs.map((entry) => {
    const parsed = roots[entry.schema]!.safeParse(entry.input);
    return { ...entry, valid: parsed.success, ...(parsed.success ? { output: parsed.data } : {}) };
});
const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const crypto = signatureFixtures.map((fixture) => ({
    seed: seed.toString('base64url'),
    publicKey,
    message: fixture.expected,
    signature: sign(null, Buffer.from(fixture.expected), privateKey).toString('base64url')
}));
const pushPrivateBytes = Buffer.alloc(32, 7);
const recipientKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), pushPrivateBytes]),
    format: 'der',
    type: 'pkcs8'
});
const ephemeralKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.alloc(32, 9)]),
    format: 'der',
    type: 'pkcs8'
});
const pushRouting = { machineId: 'machine-1', handle: key, id: 'I'.repeat(43), issuedAt: 1000, expiresAt: 121000, collapseId: 'C'.repeat(43) };
const pushContent = {
    kind: 'approval' as const,
    target: 'chat' as const,
    nodeId: 'node-1',
    title: 'Bás 📱 needs approval',
    body: 'Allow the command?',
    requestId: 'request-1',
    choices: [{ id: 'yes', kind: 'allow' as const, label: 'Allow' }],
    expiresAt: 121000
};
const pushShared = diffieHellman({ privateKey: ephemeralKey, publicKey: createPublicKey(recipientKey) });
const pushSymmetric = Buffer.from(
    hkdfSync('sha256', pushShared, Buffer.from(push.PUSH_HKDF_SALT), Buffer.from(push.pushEncryptionInfo(pushRouting.machineId, pushRouting.handle)), 32)
);
const pushNonce = Buffer.alloc(12, 3);
const pushCipher = createCipheriv('aes-256-gcm', pushSymmetric, pushNonce, { authTagLength: 16 });
pushCipher.setAAD(Buffer.from(push.pushRoutingMessage(pushRouting)));
const pushCiphertext = Buffer.concat([pushCipher.update(Buffer.from(JSON.stringify(pushContent))), pushCipher.final(), pushCipher.getAuthTag()]);
const unsignedPush = {
    ...pushRouting,
    pushType: 'alert' as const,
    ephemeralKey: createPublicKey(ephemeralKey).export({ format: 'jwk' }).x!,
    nonce: pushNonce.toString('base64url'),
    ciphertext: pushCiphertext.toString('base64url'),
    signature: ''
};
const signedPush = { ...unsignedPush, signature: sign(null, Buffer.from(signing.pushMessage(unsignedPush)), privateKey).toString('base64url') };
const pushEncryption = { privateKey: pushPrivateBytes.toString('base64url'), machinePublicKey: publicKey, push: signedPush, content: pushContent, now: 2000 };
const readContent = { nodeId: 'node-1', through: 999, expiresAt: 121000 };
const readNonce = Buffer.alloc(12, 4);
const readCipher = createCipheriv('aes-256-gcm', pushSymmetric, readNonce, { authTagLength: 16 });
readCipher.setAAD(Buffer.from(push.pushRoutingMessage(pushRouting)));
const readCiphertext = Buffer.concat([readCipher.update(Buffer.from(JSON.stringify(readContent))), readCipher.final(), readCipher.getAuthTag()]);
const unsignedRead = {
    ...unsignedPush,
    pushType: 'background' as const,
    nonce: readNonce.toString('base64url'),
    ciphertext: readCiphertext.toString('base64url')
};
const pushReadEncryption = {
    ...pushEncryption,
    content: readContent,
    push: { ...unsignedRead, signature: sign(null, Buffer.from(signing.pushMessage(unsignedRead)), privateKey).toString('base64url') }
};
const activityPush: push.PushEnvelope = {
    ...pushRouting,
    pushType: 'liveactivity',
    signature: '',
    activity: {
        title: 'Mac',
        phase: 'needs-you',
        startedAt: 1000,
        runningCount: 1,
        attentionCount: 1,
        agents: [
            { nodeId: 'review-1', target: 'chat', title: 'Review café 🚀', phase: 'needs-you', startedAt: 900 },
            { nodeId: 'build-2', target: 'terminal', title: 'Build app', phase: 'running' }
        ]
    }
};
const pushActivitySigning = { push: activityPush, message: signing.pushMessage(activityPush) };
outputs.set(
    'Tests/RuimtePulsarTests/Fixtures/wire.json',
    JSON.stringify(
        {
            pushEncryption,
            pushReadEncryption,
            pushActivitySigning,
            requestTypes: Object.keys(REQUEST_SCHEMAS),
            eventTypes: Object.keys(EVENT_SCHEMAS),
            crypto,
            signatures: signatureFixtures,
            framing: framingFixtures,
            validations,
            binding: {
                offer: offer.signal.sdp,
                answer: 'a=fingerprint:SHA-256 cc:dd\r\na=fingerprint:sha-256 CC:DD\r\n',
                expected: direct.channelBinding(offer.signal.sdp, 'a=fingerprint:SHA-256 cc:dd\r\na=fingerprint:sha-256 CC:DD\r\n')
            }
        },
        null,
        2
    ) + '\n'
);
outputs.set('../RuimteTransport/Tests/RuimteTransportTests/Fixtures/wire.json', outputs.get('Tests/RuimtePulsarTests/Fixtures/wire.json')!);
for (const [path, contents] of outputs) {
    const destination = resolve(root, path);
    if (process.argv.includes('--check')) {
        if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
            throw new Error(`Stale generated file: ${destination}`);
        }
    } else {
        await mkdir(resolve(destination, '..'), { recursive: true });
        await writeFile(destination, contents);
    }
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} ${Object.keys(schemas).length} Swift wire models and TypeScript fixtures.`);
