/*
 * What a crash report may carry. An event is rebuilt from an allow-list (stack frames, the error's
 * type and first line, a fixed set of tags, extras and contexts) and every string that survives is
 * scrubbed of paths, secrets, addresses and people. Pure, without Node or DOM imports, so the
 * daemon, the desktop shell and a page share it.
 */

export interface ScrubContext {
    /* The person's home directory; null where it is unknown, such as in a page. */
    readonly home?: string | null;
    readonly username?: string | null;
    readonly hostname?: string | null;
    /* Values that never leave as they are, such as the local secret or a project's name and folder. Read at every scrub, so the list may grow. */
    readonly redactions?: () => Iterable<string>;
    /* The tag keys that go out; every other tag is dropped. */
    readonly tags?: readonly string[];
    /* The extra keys that go out; every other extra is dropped. */
    readonly extras?: readonly string[];
    /* The breadcrumb categories that go out; every other breadcrumb is dropped. */
    readonly breadcrumbs?: readonly string[];
    /* Hosts a URL keeps, with their subdomains; any other host becomes `<host>`. */
    readonly hosts?: readonly string[];
}

export const DEFAULT_TAGS: readonly string[] = ['launcher', 'helper', 'language_server', 'hang', 'process', 'surface'];
export const DEFAULT_EXTRAS: readonly string[] = ['exit_code', 'signal', 'stderr', 'blocked_ms'];
export const DEFAULT_BREADCRUMBS: readonly string[] = ['navigation', 'ui.click', 'sentry.event', 'app.lifecycle'];
export const DEFAULT_HOSTS: readonly string[] = ['ruimte.app', 'github.com', 'githubusercontent.com', 'sentry.io', 'npmjs.org'];

const MAX_MESSAGE = 300;
const MAX_TAG = 200;
const MAX_LINES = 10;
const MAX_BREADCRUMBS = 30;
// Shorter values are too common as words to replace wherever they appear.
const MIN_REDACTION = 4;
const MIN_USERNAME = 3;

const EVENT_FIELDS = ['event_id', 'timestamp', 'level', 'platform', 'release', 'dist', 'environment', 'sdkProcessingMetadata'] as const;
const FRAME_STRINGS = ['filename', 'abs_path', 'module'] as const;
const FRAME_KEEP = ['function', 'lineno', 'colno', 'in_app', 'platform', 'instruction_addr', 'addr_mode'] as const;
const MECHANISM_FIELDS = ['type', 'handled', 'synthetic', 'exception_id', 'parent_id', 'is_exception_group', 'source'] as const;
const CONTEXT_FIELDS: Record<string, readonly string[]> = {
    os: ['name', 'version', 'build', 'kernel_version'],
    runtime: ['name', 'version'],
    device: ['arch', 'family', 'model']
};

const URL_PATTERN = /\b([a-z][a-z0-9+.-]*):\/\/([^\s'"`<>()[\]{}]*)/gi;
const GENERIC_HOME = /(?:\/Users|\/home|[A-Za-z]:[\\/]Users)[\\/][^\\/\s'"`:]+/g;
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[\w.~+/=-]+/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const SECRET_PAIR =
    /\b([\w.-]*?(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|auth(?:orization)?|credentials?|cookie|session[_-]?id|signature)[\w.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi;
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*[A-Z0-9])=("[^"]*"|'[^']*'|\S+)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LONG_TOKEN = /(?<![\w+=-])(?=[\w+=-]*\d)(?=[\w+=-]*[A-Za-z])[\w+=-]{32,}(?![\w+=-])/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const IPV6 = /(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/g;
const SQL =
    /\b(?:SELECT\b[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|DATABASE|SCHEMA)|ALTER\s+TABLE|DROP\s+(?:TABLE|DATABASE|INDEX|VIEW|SCHEMA))\b[\s\S]*/gi;
const PATH = /(^|[\s'"`(=[,])((?:~|[A-Za-z]:)?(?:[\\/][^\s'"`()[\]{},;:\\/]+)+[\\/]?)/g;
const QUOTED = /(['"`])([^'"`\n]{3,})\1/g;
// A single quote inside a word is an apostrophe, not the start or the end of a quote.
const ANY_QUOTED = /(?<!\w)'[^'\n]+'(?!\w)|"[^"\n]+"|`[^`\n]+`/g;

/*
 * Every quoted span blanked, however short. For lines of a helper's stderr, where a quote is often
 * an excerpt of the file it read, such as a token a parser stopped at.
 */
export function blankQuoted(text: string): string {
    return text.replace(ANY_QUOTED, (match) => `${match[0]}<text>${match[0]}`);
}

export interface Scrubber {
    /* A string with paths, secrets, addresses, people and SQL taken out. */
    scrubText(text: string): string;
    /* A file name of a stack frame: only the person is taken out, so the frame still resolves. */
    scrubPath(path: string): string;
    /* An event rebuilt from the allow-list; null for anything that is not an error event. */
    scrubEvent<T extends object>(event: T): T | null;
    scrubBreadcrumb<T extends object>(breadcrumb: T): T | null;
    /* A log line of a service: its first line scrubbed, and only scalar attributes, scrubbed, without the host or a person. */
    scrubLog<T extends { message: unknown; attributes?: Record<string, unknown> }>(log: T): ScrubbedLog<T>;
}

export type ScrubbedLog<T> = Omit<T, 'message' | 'attributes'> & { message: string; attributes: Record<string, string | number | boolean> };

// The SDK names the host and, when it knows one, the person; a log line of a service carries neither.
const DROPPED_LOG_ATTRIBUTE = /^(?:server\.address|user\.|client\.address)/;

export function createScrubber(context: ScrubContext = {}): Scrubber {
    const allowedTags = new Set(context.tags ?? DEFAULT_TAGS);
    const allowedExtras = new Set(context.extras ?? DEFAULT_EXTRAS);
    const allowedBreadcrumbs = new Set(context.breadcrumbs ?? DEFAULT_BREADCRUMBS);
    const hosts = context.hosts ?? DEFAULT_HOSTS;

    const literals = (): string[] => {
        const values = [...(context.redactions?.() ?? [])].filter((value) => value.length >= MIN_REDACTION);
        // The longest first, so a folder goes whole before the name of the project inside it.
        return values.sort((first, second) => second.length - first.length);
    };

    const removePerson = (text: string, withLiterals = true): string => {
        let result = text;
        for (const literal of withLiterals ? literals() : []) {
            result = result.split(literal).join('<redacted>');
        }
        const home = context.home;
        if (home) {
            result = result.replace(new RegExp(`${escapeRegExp(home)}(?![\\w.-])`, 'g'), '~');
        }
        result = result.replace(GENERIC_HOME, '~');
        const hostname = context.hostname;
        if (hostname && hostname.length >= MIN_USERNAME) {
            const short = hostname.replace(/\.local$/i, '');
            result = result.replace(new RegExp(`\\b${escapeRegExp(short)}(?:\\.local)?\\b`, 'gi'), '<host>');
        }
        const username = context.username;
        if (username && username.length >= MIN_USERNAME) {
            result = result.replace(new RegExp(`\\b${escapeRegExp(username)}\\b`, 'gi'), '<user>');
        }
        return result;
    };

    const scrubUrl = (_match: string, scheme: string, rest: string): string => {
        const end = rest.search(/[/?#]/);
        const authority = end === -1 ? rest : rest.slice(0, end);
        const remainder = end === -1 ? '' : rest.slice(end);
        const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
        const portMatch = /:(\d+)$/.exec(hostPort);
        const host = portMatch ? hostPort.slice(0, portMatch.index) : hostPort;
        const port = portMatch ? portMatch[0] : '';
        let shownHost = '<host>';
        if (host === '') {
            shownHost = '';
        } else if (isLoopback(host)) {
            shownHost = host;
        } else if (hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
            shownHost = host;
        }
        const path = remainder === '' || remainder === '/' ? remainder : '/<path>';
        return `${scheme.toLowerCase()}://${shownHost}${port}${path}`;
    };

    const scrubText = (text: string): string => {
        let result = text.replace(URL_PATTERN, scrubUrl).replace(EMAIL, '<email>');
        result = removePerson(result);
        result = result.replace(AUTH_SCHEME, '$1 <redacted>');
        result = result.replace(JWT, '<redacted>');
        result = result.replace(SECRET_PAIR, '$1$2<redacted>');
        result = result.replace(ENV_ASSIGNMENT, '$1=<redacted>');
        result = result.replace(LONG_TOKEN, '<redacted>');
        result = result.replace(IPV4, (address) => (isLoopback(address) || address === '0.0.0.0' ? address : '<ip>'));
        result = result.replace(IPV6, (address) => (looksLikeIpv6(address) ? '<ip>' : address));
        result = result.replace(SQL, '<sql>');
        result = result.replace(PATH, (match, before: string, path: string) => (isPath(path) ? `${before}<path>` : match));
        result = result.replace(QUOTED, (match, quote: string, content: string) =>
            /\s/.test(content) || content.length >= 24 ? `${quote}<text>${quote}` : match
        );
        return result;
    };

    // Only the first line: what follows is often the output of a process or the text that failed to parse.
    const scrubMessage = (text: string): string => truncate(scrubText(text.split(/\r?\n/, 1)[0] ?? ''), MAX_MESSAGE);

    const scrubPath = (path: string): string => removePerson(path.replace(/[?#].*$/, ''));

    // The app's own source names no project, and a project named like one of its folders would break symbolication and grouping.
    const scrubAppPath = (path: string): string => removePerson(path.replace(/[?#].*$/, ''), false);

    const scrubFrame = (frame: unknown): Record<string, unknown> | null => {
        if (!isRecord(frame)) {
            return null;
        }
        const result: Record<string, unknown> = {};
        const scrub = frame.in_app === true ? scrubAppPath : scrubPath;
        for (const key of FRAME_STRINGS) {
            const value = frame[key];
            if (typeof value === 'string') {
                result[key] = scrub(value);
            }
        }
        copyFields(frame, result, FRAME_KEEP);
        return result;
    };

    const scrubException = (value: unknown): Record<string, unknown> | null => {
        if (!isRecord(value)) {
            return null;
        }
        const result: Record<string, unknown> = {};
        if (typeof value.type === 'string') {
            result.type = truncate(scrubText(value.type), MAX_TAG);
        }
        if (typeof value.value === 'string') {
            result.value = scrubMessage(value.value);
        }
        if (isRecord(value.mechanism)) {
            const mechanism: Record<string, unknown> = {};
            copyFields(value.mechanism, mechanism, MECHANISM_FIELDS);
            result.mechanism = mechanism;
        }
        if (isRecord(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
            result.stacktrace = { frames: value.stacktrace.frames.map(scrubFrame).filter((frame) => frame !== null) };
        }
        return result;
    };

    const scrubValue = (value: unknown, limit: number): unknown => {
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            return truncate(scrubText(value), limit);
        }
        if (Array.isArray(value)) {
            return value
                .slice(-MAX_LINES)
                .filter((line): line is string => typeof line === 'string')
                .map((line) => truncate(scrubText(line), limit));
        }
        return undefined;
    };

    const pickRecord = (source: unknown, allowed: ReadonlySet<string>, limit: number): Record<string, unknown> | undefined => {
        if (!isRecord(source)) {
            return undefined;
        }
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(source)) {
            const scrubbed = allowed.has(key) ? scrubValue(value, limit) : undefined;
            if (scrubbed !== undefined) {
                result[key] = scrubbed;
            }
        }
        return result;
    };

    const scrubBreadcrumb = <T extends object>(breadcrumb: T): T | null => {
        const source = breadcrumb as Record<string, unknown>;
        if (typeof source.category !== 'string' || !allowedBreadcrumbs.has(source.category)) {
            return null;
        }
        const result: Record<string, unknown> = {};
        copyFields(source, result, ['type', 'category', 'level', 'timestamp']);
        if (typeof source.message === 'string') {
            result.message = scrubMessage(source.message);
        }
        const data = pickRecord(source.data, new Set(['from', 'to']), MAX_TAG);
        if (data !== undefined && Object.keys(data).length > 0) {
            result.data = data;
        }
        return result as T;
    };

    const scrubEvent = <T extends object>(event: T): T | null => {
        const source = event as Record<string, unknown>;
        // Transactions, replays and feedback carry far more than an error, and none is sent.
        if (source.type !== undefined) {
            return null;
        }
        const result: Record<string, unknown> = {};
        copyFields(source, result, EVENT_FIELDS);
        if (isRecord(source.sdk)) {
            const sdk: Record<string, unknown> = {};
            copyFields(source.sdk, sdk, ['name', 'version']);
            result.sdk = sdk;
        }
        if (Array.isArray(source.fingerprint)) {
            result.fingerprint = source.fingerprint.filter((part): part is string => typeof part === 'string').map(scrubMessage);
        }
        if (typeof source.message === 'string') {
            result.message = scrubMessage(source.message);
        }
        if (isRecord(source.logentry) && typeof source.logentry.message === 'string') {
            result.logentry = { message: scrubMessage(source.logentry.message) };
        }
        if (isRecord(source.exception) && Array.isArray(source.exception.values)) {
            result.exception = { values: source.exception.values.map(scrubException).filter((value) => value !== null) };
        }
        const tags = pickRecord(source.tags, allowedTags, MAX_TAG);
        if (tags !== undefined) {
            result.tags = tags;
        }
        const extra = pickRecord(source.extra, allowedExtras, MAX_MESSAGE);
        if (extra !== undefined) {
            result.extra = extra;
        }
        if (isRecord(source.contexts)) {
            const contexts: Record<string, unknown> = {};
            for (const [name, fields] of Object.entries(CONTEXT_FIELDS)) {
                const value = source.contexts[name];
                if (isRecord(value)) {
                    const picked: Record<string, unknown> = {};
                    copyFields(value, picked, fields);
                    contexts[name] = mapStrings(picked, scrubText);
                }
            }
            result.contexts = contexts;
        }
        if (Array.isArray(source.breadcrumbs)) {
            result.breadcrumbs = source.breadcrumbs
                .filter(isRecord)
                .map(scrubBreadcrumb)
                .filter((breadcrumb) => breadcrumb !== null)
                .slice(-MAX_BREADCRUMBS);
        }
        if (isRecord(source.debug_meta) && Array.isArray(source.debug_meta.images)) {
            const images = source.debug_meta.images.filter(isRecord).map((image) => {
                const picked: Record<string, unknown> = {};
                copyFields(image, picked, ['type', 'debug_id']);
                if (typeof image.code_file === 'string') {
                    picked.code_file = scrubPath(image.code_file);
                }
                return picked;
            });
            result.debug_meta = { images };
        }
        return result as T;
    };

    const scrubLog = <T extends { message: unknown; attributes?: Record<string, unknown> }>(log: T): ScrubbedLog<T> => {
        const attributes: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(log.attributes ?? {})) {
            if (DROPPED_LOG_ATTRIBUTE.test(key)) {
                continue;
            }
            if (typeof value === 'string') {
                attributes[key] = truncate(scrubText(value), MAX_MESSAGE);
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                attributes[key] = value;
            }
        }
        return { ...log, message: scrubMessage(String(log.message)), attributes };
    };

    return { scrubText, scrubPath, scrubEvent, scrubBreadcrumb, scrubLog };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyFields(source: Record<string, unknown>, target: Record<string, unknown>, fields: readonly string[]): void {
    for (const field of fields) {
        if (source[field] !== undefined) {
            target[field] = source[field];
        }
    }
}

function mapStrings(record: Record<string, unknown>, map: (text: string) => string): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === 'string' ? map(value) : value]));
}

function truncate(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLoopback(host: string): boolean {
    return host === 'localhost' || host === '[::1]' || host === '::1' || host.startsWith('127.');
}

// A clock reads `08:35:12` and is no address; an address has a hex letter, `::` or more groups than a clock.
function looksLikeIpv6(candidate: string): boolean {
    if (candidate === '::1' || candidate === '::') {
        return false;
    }
    return candidate.includes('::') || /[a-f]/i.test(candidate) || candidate.split(':').length > 4;
}

// One segment from the root is a route such as `/health`; a path under the home or a drive always counts.
function isPath(path: string): boolean {
    if (path.startsWith('~') || /^[A-Za-z]:/.test(path)) {
        return true;
    }
    return path.split(/[\\/]/).filter((segment) => segment !== '').length >= 2;
}
