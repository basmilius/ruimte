/*
 * The Beacon service, as this extension would reach it over the network: the rules of an account and what they found
 * on the pages it knows, as fixed data. A page it does not know has no findings.
 */

// A type and no interface: a finding is kept in storage, which takes only what is JSON by its shape.
export type Finding = {
    rule: string;
    severity: 'high' | 'medium' | 'low';
    text: string;
};

export interface ReportInput {
    title: string;

    /* A url, or the name of a device. */
    subject: string;

    /* What was true when it was checked, a line each. */
    state: string[];

    findings: Finding[];
    notes: string[];
    summary: string | null;
}

const BY_PATH: Readonly<Record<string, readonly Finding[]>> = {
    '/': [
        { rule: 'contrast', severity: 'medium', text: 'The gray text under the heading is too light to read on white.' },
        { rule: 'alt-text', severity: 'low', text: 'The picture at the top has no description.' }
    ],
    '/checkout': [
        { rule: 'labels', severity: 'high', text: 'The card number field has no label, so a screen reader announces nothing.' },
        { rule: 'errors', severity: 'high', text: 'A refused card shows no message.' },
        { rule: 'focus', severity: 'medium', text: 'The Pay button cannot be reached with the keyboard.' }
    ]
};

const DEVICE: readonly Finding[] = [{ rule: 'tap-size', severity: 'medium', text: 'The close button is smaller than a finger.' }];

/* The findings of the rules on a page, by its path alone: the same page on another host or port is the same page. */
export function findingsFor(url: string): Finding[] {
    const path = URL.canParse(url) ? new URL(url).pathname : url;

    return [...(BY_PATH[path.replace(/(.)\/$/, '$1')] ?? [])];
}

export function deviceFindings(): Finding[] {
    return [...DEVICE];
}

export function reportText(report: ReportInput): string {
    const findings = report.findings.map((finding) => `- **${finding.severity}** ${finding.text} (${finding.rule})`);

    return [
        `# ${report.title}`,
        '',
        `Checked: ${report.subject}`,
        ...report.state.map((line) => `- ${line}`),
        ...(report.summary === null ? [] : ['', report.summary]),
        '',
        `## Findings (${report.findings.length})`,
        '',
        ...(findings.length === 0 ? ['Nothing found.'] : findings),
        ...(report.notes.length === 0 ? [] : ['', '## Notes', '', ...report.notes.map((note) => `- ${note}`)]),
        ''
    ].join('\n');
}
