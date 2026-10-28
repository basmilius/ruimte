import { describe, expect, test } from 'bun:test';
import { editsCss, editsOf, withEdits, withTweakValues } from './design-file';
import { bakePrompt, commentsPrompt, textEditPrompt } from './design-messages';

const element = {
    selector: '#2a > a:nth-of-type(1)',
    option: '2a',
    name: 'a.cta',
    html: '<a class="cta">\n  Open\n</a>',
    text: 'Open',
    rect: { x: 0, y: 0, width: 114.4, height: 34 },
    style: {}
};

describe('the overrides block of a page', () => {
    test('goes at the end of the head the first time, and is the only part of the file a save changes', () => {
        const page = '<html><head><title>x</title></head><body><a class="cta">Open</a></body></html>';
        const saved = withEdits(page, { '#2a > a:nth-of-type(1)': { padding: '12px 20px' } });

        expect(saved).toBe(
            '<html><head><title>x</title><style id="ruimte-edits">\n#2a > a:nth-of-type(1) { padding: 12px 20px !important; }\n</style>\n</head><body><a class="cta">Open</a></body></html>'
        );
        expect(editsOf(saved)).toEqual({ '#2a > a:nth-of-type(1)': { padding: '12px 20px' } });
    });

    test('merges a later edit over what it held, per selector and property', () => {
        const first = withEdits('<p>x</p>', { '#1a': { color: 'red', 'font-size': '20px' } });
        const second = withEdits(first, { '#1a': { color: 'blue' }, '#1b': { 'border-radius': '8px' } });

        expect(editsOf(second)).toEqual({ '#1a': { color: 'blue', 'font-size': '20px' }, '#1b': { 'border-radius': '8px' } });
        expect(second.match(/ruimte-edits/g)).toHaveLength(1);
        expect(editsCss(editsOf(second))).toBe('#1a { color: blue !important; font-size: 20px !important; }\n#1b { border-radius: 8px !important; }');
    });
});

describe('the tweaks of a page', () => {
    test('take new values in their declaration, keep every other key, and ignore a name the page does not declare', () => {
        const page = '<script type="application/json" id="ruimte-tweaks">{"accent":{"type":"color","options":["#111","#222"],"value":"#111"}}</script><p>x</p>';
        const saved = withTweakValues(page, { accent: '#222', missing: 3 })!;

        expect(JSON.parse(/id="ruimte-tweaks">([\s\S]*?)<\/script>/.exec(saved)![1]!)).toEqual({
            accent: { type: 'color', options: ['#111', '#222'], value: '#222' }
        });
        expect(saved.endsWith('</script><p>x</p>')).toBe(true);
        expect(withTweakValues('<p>no tweaks</p>', { accent: '#222' })).toBeNull();
    });
});

describe('what the stage tells the chat', () => {
    test('names every comment by its option, element and markup, in one message', () => {
        const prompt = commentsPrompt('Onboarding.html', [
            { element, text: 'Make this a secondary button.' },
            { element: { ...element, option: null, selector: 'body > h1:nth-of-type(1)', name: 'h1', html: '' }, text: ' Shorter. ' }
        ]);

        expect(prompt).toContain('Comments on Onboarding.html');
        expect(prompt).toContain('1. On option 2a, a.cta (`#2a > a:nth-of-type(1)`), 114×34:\n   <a class="cta"> Open </a>\n   Make this a secondary button.');
        expect(prompt).toContain('2. On h1 (`body > h1:nth-of-type(1)`), 114×34:\n   Shorter.');
    });

    test('hands text changed in place and the overrides to the chat to write into the source', () => {
        expect(textEditPrompt('Onboarding.html', element, 'Open', 'Open a project')).toContain('Before: Open\nAfter: Open a project');
        expect(bakePrompt('Onboarding.html', '#1a { color: blue !important; }')).toContain('```css\n#1a { color: blue !important; }\n```');
    });
});
