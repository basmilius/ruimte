import { agents, artifacts, browser, devices, getServer, storage, type NodeInfo, type Result } from '@ruimte/extension/client';
import type { BeaconServer, Finding } from '../server/index';

export const LAST = 'last';
export const NOTES = 'notes';

/* What the panel and a chat read of the last check. */
export type LastReport = {
    title: string;
    subject: string;
    findings: Finding[];
    summary: string | null;
    artifact: string;
};

/* A check that throws shows the person why, so a refusal ends one that way. */
function valueOf<Value>(result: Result<Value>): Value {
    if (!result.ok) {
        throw new Error(result.error.message);
    }

    return result.value;
}

/* A key Output takes: lower case letters, digits and dashes, 64 at most. */
export function keyOf(subject: string): string {
    const words = subject
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return `beacon-${words}`.slice(0, 64);
}

export function lastReport(): LastReport | null {
    return storage.get<LastReport>(LAST) ?? null;
}

export function notes(): string[] {
    return storage.get<string[]>(NOTES) ?? [];
}

/* The last report as a chat reads it. */
export function reportMessage(report: LastReport): string {
    const findings = report.findings.map((finding) => `- ${finding.severity}: ${finding.text}`);

    return [`Beacon checked ${report.subject} and found ${report.findings.length} things to fix:`, ...findings, '', 'Fix these, the high ones first.'].join(
        '\n'
    );
}

/* Sums up with an agent of the person, and goes without when none answers: the findings stand without a summary. */
async function summaryOf(findings: readonly Finding[]): Promise<string | null> {
    if (findings.length === 0) {
        return null;
    }

    const answer = await agents.run({
        prompt: 'Sum up these findings of a QA check in two lines, for the person who fixes them.',
        context: findings.map((finding) => `${finding.severity}: ${finding.text}`)
    });

    return answer.ok ? answer.value.text : null;
}

async function keep(title: string, subject: string, state: string[], findings: Finding[]): Promise<LastReport> {
    const summary = await summaryOf(findings);
    const text = valueOf(await getServer<BeaconServer>().report({ title, subject, state, findings, notes: notes(), summary }));
    // One artifact per subject, so a second check is a new version of the same report.
    const published = valueOf(await artifacts.publish({ files: [{ name: 'report.md', text }], title, kind: 'report', key: keyOf(subject) }));
    const report = { title, subject, findings, summary, artifact: published.artifact.id };

    valueOf(storage.set(LAST, report));
    valueOf(storage.delete(NOTES));

    return report;
}

export async function checkPage(node: NodeInfo): Promise<LastReport> {
    const { page } = valueOf(await browser.inspect({ node }));

    if (page === null) {
        throw new Error('Open the page in this browser first');
    }

    const findings = valueOf(await getServer<BeaconServer>().findings(page.url));
    const shot = valueOf(await browser.screenshot({ node }));

    return keep(`Beacon: ${page.title || page.url}`, page.url, [`Title: ${page.title}`, ...(shot.path === null ? [] : [`Picture: ${shot.path}`])], findings);
}

export async function checkDevice(node: NodeInfo): Promise<LastReport> {
    const state = valueOf(await devices.inspect({ node }));

    if (!state.present || state.state !== 'booted') {
        throw new Error(`${state.device.name} is not running`);
    }

    const findings = valueOf(await getServer<BeaconServer>().deviceFindings());
    const shot = valueOf(await devices.screenshot({ node }));

    return keep(`Beacon: ${state.device.name}`, state.device.name, [`${state.device.platform} ${state.device.runtime}`, `Picture: ${shot.path}`], findings);
}
