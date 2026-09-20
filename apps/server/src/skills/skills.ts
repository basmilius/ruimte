import { existsSync, type Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import type { AgentKind, ChatSkill, ChatSkillSource } from '@ruimte/contracts';
import { isNotFound } from '../fs.ts';

// One folder full of skill folders, and what the CLI calls the skills it finds there.
export interface SkillRoot {
    dir: string;
    source: ChatSkillSource;
    // A plugin names its skills `<plugin>:<skill>`, the way the CLI's init frame does.
    prefix?: string;
}

export interface SkillRootOptions {
    // The person's home directory; a test points it at a temporary tree.
    home?: string;
    // Where Claude Code keeps its own configuration, when it is not `<home>/.claude`.
    claudeConfigDir?: string;
}

const NAME = /^[A-Za-z][A-Za-z0-9_:-]*$/;

const unquote = (value: string): string => {
    const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
    return quoted ? quoted[2]! : value;
};

/*
 * The `key: value` pairs of a SKILL.md front matter. Enough YAML for what a skill file holds: flat
 * keys, quoted or bare values, and the block scalars (`>-`, `|`) a long description is written as.
 */
export const parseFrontmatter = (text: string): Record<string, string> => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!match) {
        return {};
    }
    const fields: Record<string, string> = {};
    const lines = match[1]!.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const pair = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]!);
        if (!pair) {
            continue;
        }
        let value = pair[2]!.trim();
        if (value === '' || value === '>' || value === '>-' || value === '|' || value === '|-') {
            // A block scalar puts the value on the indented lines under it; `|` keeps the newlines.
            const keepNewlines = value.startsWith('|');
            const parts: string[] = [];
            while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1]!)) {
                parts.push(lines[++i]!.trim());
            }
            value = parts.join(keepNewlines ? '\n' : ' ');
        }
        fields[pair[1]!] = unquote(value);
    }
    return fields;
};

/*
 * The folders from `cwd` up to and including the repository root, closest first. The home folder
 * itself is not one of them, since its `.claude/skills` is already the user root.
 */
const projectDirs = (cwd: string, home: string): string[] => {
    const dirs: string[] = [];
    let current = cwd;
    while (current !== '' && current !== parse(current).root && current !== home && current !== dirname(home) && dirs.length < 8) {
        dirs.push(current);
        // Anything above a repository root belongs to another project, so the walk ends there.
        if (existsSync(join(current, '.git'))) {
            break;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return dirs;
};

/* The plugin folders Claude Code installed, each named the way its skills are addressed. */
export const pluginSkillRoots = async (configDir: string): Promise<SkillRoot[]> => {
    let raw: string;
    try {
        raw = await readFile(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return [];
        }
        throw e;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    const plugins = typeof parsed === 'object' && parsed !== null ? (parsed as { plugins?: unknown }).plugins : undefined;
    if (typeof plugins !== 'object' || plugins === null) {
        return [];
    }
    const roots: SkillRoot[] = [];
    for (const [key, installs] of Object.entries(plugins as Record<string, unknown>)) {
        const name = key.split('@')[0] ?? key;
        for (const install of Array.isArray(installs) ? installs : []) {
            const path = typeof install === 'object' && install !== null ? (install as { installPath?: unknown }).installPath : undefined;
            if (typeof path === 'string' && path !== '') {
                roots.push({ dir: join(path, 'skills'), source: 'plugin', prefix: name });
            }
        }
    }
    return roots;
};

/* Where a provider's CLI looks for skills, in the order a name clash is decided. */
export const skillRootsFor = async (kind: AgentKind, cwd: string, options: SkillRootOptions = {}): Promise<SkillRoot[]> => {
    const home = options.home ?? homedir();
    if (kind === 'codex') {
        return [
            { dir: join(home, '.agents', 'skills'), source: 'user' },
            { dir: join(home, '.codex', 'skills'), source: 'user' },
            ...projectDirs(cwd, home).map((dir): SkillRoot => ({ dir: join(dir, '.agents', 'skills'), source: 'project' }))
        ];
    }
    const configDir = options.claudeConfigDir ?? join(home, '.claude');
    return [
        { dir: join(configDir, 'skills'), source: 'user' },
        ...projectDirs(cwd, home).map((dir): SkillRoot => ({ dir: join(dir, '.claude', 'skills'), source: 'project' })),
        ...(await pluginSkillRoots(configDir))
    ];
};

const readSkill = async (root: SkillRoot, folder: string): Promise<ChatSkill | null> => {
    let text: string;
    try {
        text = await readFile(join(root.dir, folder, 'SKILL.md'), 'utf8');
    } catch {
        return null;
    }
    const fields = parseFrontmatter(text);
    const own = fields.name && NAME.test(fields.name) ? fields.name : folder;
    const name = root.prefix ? `${root.prefix}:${own}` : own;
    if (!NAME.test(name)) {
        return null;
    }
    return { name, description: fields.description ?? '', source: root.source };
};

/* Every skill under these roots, sorted by name; the first root that carries a name wins. */
export const scanSkillRoots = async (roots: SkillRoot[]): Promise<ChatSkill[]> => {
    const found = new Map<string, ChatSkill>();
    for (const root of roots) {
        let entries: Dirent[];
        try {
            entries = await readdir(root.dir, { withFileTypes: true });
        } catch {
            continue;
        }
        const skills = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readSkill(root, entry.name)));
        for (const skill of skills) {
            if (skill && !found.has(skill.name)) {
                found.set(skill.name, skill);
            }
        }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const discoverSkills = async (kind: AgentKind, cwd: string, options: SkillRootOptions = {}): Promise<ChatSkill[]> =>
    scanSkillRoots(await skillRootsFor(kind, cwd, options));

// How long a scan stays good; a skill written mid-session shows up on the next look.
const CACHE_TTL_MS = 30_000;

/* The skills of one CLI in one folder, scanned at most once per half minute. There is no watcher. */
export class SkillIndex {
    private readonly options: SkillRootOptions;
    private readonly cache = new Map<string, { at: number; skills: ChatSkill[] }>();

    constructor(options: SkillRootOptions = {}) {
        this.options = options;
    }

    async list(kind: AgentKind, cwd: string): Promise<ChatSkill[]> {
        const key = `${kind}:${cwd}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return cached.skills;
        }
        const skills = await discoverSkills(kind, cwd, this.options);
        this.cache.set(key, { at: Date.now(), skills });
        return skills;
    }
}
