import { definitionRunsProgram } from '@adecore/service';

/* Who the definition on disk belongs to: nobody, this installation of the app, or anything else. */
export type ServiceOwnership = 'none' | 'this' | 'other';

export interface ServiceIdentity {
    ruimteHome: string;
    commandLineProgram: string;
}

const HOME_VARIABLE = 'RUIMTE_HOME';

function unescapeXml(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function plistHome(definition: string): string | null {
    const xml = definition.replace(/<!--[\s\S]*?-->/g, '');
    const found = [...xml.matchAll(/<key>RUIMTE_HOME<\/key>\s*<string>([^<]*)<\/string>/g)];
    if (found.length !== 1) {
        return null;
    }
    return unescapeXml(found[0]![1]!);
}

/* systemd reads every `Environment=` line of `[Service]` in order, the last assignment of a name wins and an empty one clears them all. */
function unitHome(definition: string): string | null {
    let service = false;
    let home: string | null = null;
    for (const raw of definition.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('#') || line.startsWith(';')) {
            continue;
        }
        if (/^\[.*\]$/.test(line)) {
            service = line === '[Service]';
            continue;
        }
        const assignments = service ? /^Environment\s*=\s*(.*)$/.exec(line)?.[1] : undefined;
        if (assignments === undefined) {
            continue;
        }
        if (assignments === '') {
            home = null;
            continue;
        }
        for (const word of assignments.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
            const assignment = (word[1] !== undefined ? word[1].replace(/\\(.)/g, '$1') : word[2]!).replace(/%%/g, '%');
            if (assignment.startsWith(`${HOME_VARIABLE}=`)) {
                home = assignment.slice(HOME_VARIABLE.length + 1);
            }
        }
    }
    return home;
}

/* The task's script sets each variable as `set ^"NAME=value^"`, every character cmd reads as syntax behind a caret and a percent doubled; the last one wins. */
function scheduledTaskHome(definition: string): string | null {
    const script = /<Documentation>([^<]*)<\/Documentation>/.exec(definition)?.[1];
    if (script !== undefined) {
        return taskHomeOf(unescapeXml(script).split('\r\n'), (value) => value.replace(/%%/g, '%'));
    }
    // A task from before the script holds the same on its one line, with a percent as it is.
    const exec = definition.match(/<Exec>[\s\S]*?<\/Exec>/g);
    if (exec?.length !== 1) {
        return null;
    }
    const args = /<Arguments>([^<]*)<\/Arguments>/.exec(exec[0])?.[1];
    const line = args === undefined ? undefined : /\/c "([\s\S]*)"$/.exec(unescapeXml(args))?.[1];
    if (line === undefined) {
        return null;
    }
    return taskHomeOf(line.split(' && '), (value) => value);
}

function taskHomeOf(steps: string[], percents: (value: string) => string): string | null {
    let home: string | null = null;
    for (const step of steps) {
        const assignment = /^set "(.*)"$/.exec(percents(step.replace(/\^(.)/g, '$1')))?.[1];
        if (assignment?.startsWith(`${HOME_VARIABLE}=`)) {
            home = assignment.slice(HOME_VARIABLE.length + 1);
        }
    }
    return home;
}

/* The home a definition gives its daemon, as `daemonServiceSpec` writes it; null when it names none. */
export function definitionHome(definition: string): string | null {
    if (/<Task[\s>]/.test(definition)) {
        return scheduledTaskHome(definition);
    }
    return definition.trimStart().startsWith('<') ? plistHome(definition) : unitHome(definition);
}

/*
 * An installation is its home, not the path of its binary: an app that moved or updated still writes
 * the same home, while another home is another installation. The service `ruimte service install`
 * set up for this home is not the app's either, and neither is a definition that names no home.
 */
export function serviceOwnership(definition: string | null, identity: ServiceIdentity): ServiceOwnership {
    if (definition === null) {
        return 'none';
    }
    if (definitionHome(definition) !== identity.ruimteHome || definitionRunsProgram(definition, identity.commandLineProgram)) {
        return 'other';
    }
    return 'this';
}
