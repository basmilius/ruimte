import { createCipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, sign } from 'node:crypto';
import { CameraSchema, CanvasNodeSchema, NodeKindSchema, PROJECT_VIEW_KINDS, ProjectViewSchema, ProjectCanvasViewSchema } from '../src/project.ts';
import { REQUEST_SCHEMAS, EVENT_SCHEMAS } from '../src/index.ts';
import { BYTES_CHUNK_MAX, BYTES_READ_MAX_BYTES } from '../src/bytes.ts';
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
roots.PairPayloadSchema = PairPayloadSchema;
roots.PairResultSchema = PairResultSchema;
roots.ProjectCanvasDefaultsSchema = ProjectCanvasViewSchema.pick({ layouts: true });
const schemas: Record<string, Schema> = {};
for (const [name, schema] of Object.entries(roots)) {
    schemas[name] = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' });
}
// JSON Schema cannot carry Zod refinements; retain the statement lifetime check explicitly.
const stampStatement = (schema: Schema): void => {
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
};
Object.values(schemas).forEach(stampStatement);
const canonical = (schema: Schema): string => JSON.stringify(schema, (key, value) => (key === '$schema' ? undefined : value));
const names = new Map(
    Object.entries(schemas).map(([name, schema]) => [canonical(schema), name.replace(/Schema$/, '') === 'Error' ? 'WireError' : name.replace(/Schema$/, '')])
);
const declarations = new Map<string, string>();
const camel = (name: string): string => name.replace(/[-. ]+(\w)/g, (_match, letter) => letter.toUpperCase());
const identifier = (name: string): string => `\`${camel(name)}\``;
const nullable = (schema: Schema): Schema | undefined =>
    Array.isArray(schema.type) && schema.type.includes('null')
        ? { ...schema, type: schema.type.find((type: string) => type !== 'null') }
        : schema.anyOf?.length === 2 && schema.anyOf.some((entry: Schema) => entry.type === 'null')
          ? schema.anyOf.find((entry: Schema) => entry.type !== 'null')
          : undefined;
const typeOf = (schema: Schema, suggested: string, force = false): string => {
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
            `public enum ${name}: String, Codable, Sendable, Equatable {\n${schema.enum.map((value: string) => `    case ${identifier(value)} = ${JSON.stringify(value)}`).join('\n')}\n}`
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
        const schemaName = Object.entries(schemas).find(([, value]) => canonical(value) === canonical(schema))?.[0];
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
    if (Object.keys(schema).every((key) => ['$schema', 'default'].includes(key))) {
        return 'JSONValue';
    }
    throw new Error(`Unsupported schema ${suggested}: ${JSON.stringify(schema)}`);
};
for (const [name, schema] of Object.entries(schemas)) {
    const clean = name === 'ErrorSchema' ? 'WireError' : name.replace(/Schema$/, '');
    const type = typeOf(schema, clean, true);
    if (type !== clean) {
        declarations.set(clean, `public typealias ${clean} = ${type}`);
    }
}
const constants = {
    protocolVersion: PROTOCOL_VERSION,
    bytesChunkMax: BYTES_CHUNK_MAX,
    pushMaxAgeMs: push.PUSH_MAX_AGE_MS,
    pushMaxClockSkewMs: push.PUSH_MAX_CLOCK_SKEW_MS,
    pushHKDFSalt: push.PUSH_HKDF_SALT,
    bytesReadMaxBytes: BYTES_READ_MAX_BYTES,
    directChannelLabel: direct.DIRECT_CHANNEL_LABEL,
    directPieceChars: direct.DIRECT_PIECE_CHARS,
    directPingIdleMs: liveness.DIRECT_PING_IDLE_MS,
    directPingTimeoutMs: liveness.DIRECT_PING_TIMEOUT_MS,
    directPingTickMs: liveness.DIRECT_PING_TICK_MS,
    addressBookURL: address.ADDRESS_BOOK_URL,
    appRedirectURI: address.APP_REDIRECT_SCHEME_URI,
    statementPublicKeys: PULSAR_STATEMENT_PUBLIC_KEYS
};
const constantSource = Object.entries(constants)
    .map(
        ([name, value]) =>
            `    public static let ${name}: ${Array.isArray(value) ? '[String]' : typeof value === 'string' ? 'String' : name === 'protocolVersion' ? 'Int64' : name === 'directPieceChars' ? 'Int' : 'Double'} = ${JSON.stringify(value)}`
    )
    .join('\n');
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
    if (name === 'request.chat.send.payload') schemas[name]!['x-message-content'] = true;
    if (name === 'request.session.attach.payload') schemas[name]!['x-follow-dimensions'] = true;
}
const tableSource = (name: string, entries: string[], methods: string): string =>
    `public enum ${name}: String, CaseIterable, Sendable {\n${entries.map((entry) => `    case ${identifier(entry)} = ${JSON.stringify(entry)}`).join('\n')}\n\n${methods}\n}`;
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
const root = resolve(import.meta.dir, '../../../apps/ios/Packages/RuimtePulsar');
const outputs = new Map<string, string>([
    [
        'Sources/RuimtePulsar/Generated/DaemonAPI.swift',
        `// Generated by packages/contracts/scripts/generate-swift.ts; edit the TypeScript schemas.\n${apiSource}\n`
    ],
    [
        'Sources/RuimtePulsar/Generated/Models.swift',
        `// Generated by packages/contracts/scripts/generate-swift.ts; edit the TypeScript schemas.\nimport Foundation\n\npublic enum WireConstants {\n${constantSource}\n}\n\n${[...declarations.values()].join('\n\n')}\n`
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
    { schema: 'request.chat.send.payload', input: { chatId: 'c', text: '' } },
    { schema: 'request.chat.send.payload', input: { chatId: 'c', text: 'Hello' } }
);
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
const signedPush = { ...unsignedPush, signature: sign(null, Buffer.from(push.pushMessage(unsignedPush)), privateKey).toString('base64url') };
const pushEncryption = { privateKey: pushPrivateBytes.toString('base64url'), machinePublicKey: publicKey, push: signedPush, content: pushContent, now: 2000 };
outputs.set(
    'Tests/RuimtePulsarTests/Fixtures/wire.json',
    JSON.stringify(
        {
            pushEncryption,
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
