import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { ProjectCanvasViewSchema } from '../src/project.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import * as address from '../../pulsar/src/address-book.ts';
import * as broker from '../../pulsar/src/broker.ts';
import * as signaling from '../../pulsar/src/signaling.ts';
import * as direct from '../src/direct.ts';
import * as server from '../src/server.ts';
import * as envelope from '../src/envelope.ts';
import * as signing from '../../pulsar/src/signing.ts';
import * as liveness from '../src/direct-liveness.ts';
import { PROTOCOL_VERSION } from '../src/protocol.ts';
import { PULSAR_STATEMENT_PUBLIC_KEYS } from '../../pulsar/src/statement-key.ts';

type Schema = Record<string, any>;
const roots: Record<string, z.ZodType> = {};
for (const module of [address, broker, signaling, direct, server, envelope]) {
    for (const [name, value] of Object.entries(module)) {
        if (name.endsWith('Schema') && value instanceof z.ZodType && name !== 'LoginStartQuerySchema') {
            roots[name] = value;
        }
    }
}
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
            `public struct ${name}: Codable, Sendable, Equatable {\n${fields}\n\n    public init(${parameters}) {\n${assignment}\n    }\n\n    public init(from decoder: Decoder) throws {\n${schemaName ? `        _ = try WireSchema.validate(${JSON.stringify(schemaName)}, JSONValue(from: decoder))\n` : ''}        let container = try decoder.container(keyedBy: CodingKeys.self)\n${decoding}\n    }\n\n    public func encode(to encoder: Encoder) throws {\n        var container = encoder.container(keyedBy: CodingKeys.self)\n${encoding}\n    }\n\n    private enum CodingKeys: String, CodingKey {\n${properties.length ? properties.map(({ key }) => `        case ${identifier(key)} = ${JSON.stringify(key)}`).join('\n') : '        case unused'}\n    }\n}`
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
            ? `        let container = try decoder.container(keyedBy: Tag.self)\n        switch try container.decode(${typeof members[0].properties[tag].const === 'boolean' ? 'Bool' : 'String'}.self, forKey: .value) {\n${cases.map(({ label, type }: any) => `        case ${JSON.stringify(members[cases.findIndex((entry: any) => entry.label === label)].properties[tag].const)}: self = .${identifier(label)}(try ${type}(from: decoder))`).join('\n')}\n        default: throw WireValidationError.invalid("Unknown ${name} tag")\n        }`
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
const root = resolve(import.meta.dir, '../../../apps/ios/Packages/RuimtePulsar');
const outputs = new Map<string, string>([
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
const validationInputs = [
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
outputs.set(
    'Tests/RuimtePulsarTests/Fixtures/wire.json',
    JSON.stringify(
        {
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
