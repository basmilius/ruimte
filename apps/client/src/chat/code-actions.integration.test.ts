import { expect, test } from 'bun:test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clientDirectory, withBrowserFixture } from '../../testing/browser-fixture';

type View = InstanceType<typeof Bun.WebView>;
const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
const plain = '  héllo  \n\tkeep spaces\n\n';
const long = 'const longLine = "' + 'wide text '.repeat(20) + '";';
const shell = '```bash\nprintf ready\n```\n\nReply continues.\n';

async function fixture(run: (view: View) => Promise<void>): Promise<void> {
    const assets = join(clientDirectory, 'dist/assets');
    const sheets = (await readdir(assets)).filter((name) => name.endsWith('.css'));
    const styles = (await Promise.all(sheets.map((name) => readFile(join(assets, name), 'utf8')))).join('\n');
    const resolve = (name: string) => JSON.stringify(Bun.resolveSync(name, clientDirectory));
    await withBrowserFixture(
        `
        import { Markdown, MessageMarkdown } from ${resolve('@adecore/agents-react/chat/ui/Markdown')};
        import { AssistantRow } from ${resolve('@adecore/agents-react/chat/ui/rows/MessageRows')};
        import { ChatScopeContext } from ${resolve('@adecore/agents-react/scope')};
        import { ReplyContext } from ${resolve('@adecore/agents-react/chat/ui/reply-context')};
        import { setChatHost } from ${resolve('@adecore/agents-react/host')};
        import { connectWorkspaceChatHost } from ${JSON.stringify(join(clientDirectory, 'src/chat/workspace-host.ts'))};
        import { useTheme } from ${JSON.stringify(join(clientDirectory, 'src/state/theme.ts'))};
        import { useEndpoints } from ${JSON.stringify(join(clientDirectory, 'src/state/endpoints.ts'))};
        import { Toasts } from ${JSON.stringify(join(clientDirectory, 'src/shell/Toasts.tsx'))};
        import words from ${JSON.stringify(join(clientDirectory, 'src/i18n/locales/en/chat.json'))};
        import dutch from ${JSON.stringify(join(clientDirectory, 'src/i18n/locales/nl/chat.json'))};
        import shared from ${resolve('@adecore/agents-react/locales/en/agent-chat.json')};
        import sharedDutch from ${resolve('@adecore/agents-react/locales/nl/agent-chat.json')};
        i18next.addResourceBundle('en','chat',words,true,true);
        i18next.addResourceBundle('nl','chat',dutch,true,true);
        i18next.addResourceBundle('en','agent-chat',shared,true,true);
        i18next.addResourceBundle('nl','agent-chat',sharedDutch,true,true);
        window.changeLanguage=language=>i18next.changeLanguage(language);
        window.copies=[];window.failCopy=false;window.holdCopy=false;
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){
            window.copies.push(text);
            if(window.failCopy) return Promise.reject(new Error('Clipboard refused'));
            if(window.holdCopy) return new Promise(resolve=>window.releaseCopy=resolve);
            return Promise.resolve();
        }}});
        useEndpoints.setState({endpoints:[],activeId:'different-machine'});
        useTheme.getState().setTheme('light');
        connectWorkspaceChatHost();
        window.badTheme=false;window.changeTheme=theme=>useTheme.getState().setTheme(theme);
        setChatHost({useStreaming:()=> 'blocks',code:{useMode:()=>useTheme(state=>state.resolved),useThemes:()=>({light:window.badTheme?'missing-theme-for-fallback':'github-light',dark:window.badTheme?'missing-theme-for-fallback':'github-dark'}),custom:[]}});
        function Fixture(){
            const [streaming,changeStreaming]=React.useState(true);
            const [text,changeText]=React.useState(${JSON.stringify(shell)});
            const [child,changeChild]=React.useState(false);
            const [fallback,changeFallback]=React.useState(false);
            const [empty,showEmpty]=React.useState(false);
            window.showEmpty=()=>showEmpty(true);
            window.changeStreaming=changeStreaming;window.changeText=changeText;window.changeChild=changeChild;
            window.useFallback=()=>{window.badTheme=true;useTheme.getState().toggle();changeFallback(true);};
            const scope={id:'original-machine',keyOf:id=>'original-machine/'+id,owns:key=>key.startsWith('original-machine/'),transport:{},chats:{}};
            return <ChatScopeContext.Provider value={scope}><main id="examples" data-fallback={fallback}>
                <h1>Chat code actions</h1>
                <section data-plain><Markdown text={${JSON.stringify('```\n' + plain + '\n```')}}/></section>
                <section data-long><Markdown text={${JSON.stringify('```not-a-language\n' + long + '\n```')}}/></section>
                <section data-inline><Markdown text="Inline \x60printf inline\x60"/></section>
                <section data-shell><ReplyContext.Provider value={child?{provider:'claude',chatId:'child'}:null}>
                    <AssistantRow chatId="source-chat" item={{id:'source-item',kind:'assistant',turnId:null,createdAt:0,text,streaming}}/>
                </ReplyContext.Provider></section>
                {empty&&<>
                    <section data-empty="markdown"><Markdown text={${JSON.stringify('```\n```')}}/></section>
                    <section data-empty="plain"><Markdown text={${JSON.stringify('```\n```')}} fileLinks={false}/></section>
                    <section data-empty="message"><MessageMarkdown text={${JSON.stringify('```\n```')}}/></section>
                    <section data-empty="assistant"><AssistantRow chatId="source-chat" item={{id:'empty',kind:'assistant',turnId:null,createdAt:0,text:${JSON.stringify('```\n```')},streaming:false}}/></section>
                </>}
            </main><Toasts/></ChatScopeContext.Provider>;
        }
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><Fixture/></UIProvider>);
        `,
        `${styles}\n#root{width:auto;height:auto}body{padding:24px;background:var(--bg);color:var(--text)}#examples{width:620px}h1{margin-bottom:16px;font-size:var(--text-lg)}section{margin-bottom:20px}`,
        async (view) => {
            await waitFor(view, 'document.querySelectorAll(".chat-code pre:not(.invisible)").length===3');
            await run(view);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}

async function waitFor(view: View, expression: string): Promise<void> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        if (await view.evaluate<boolean>(expression)) {
            return;
        }
        await view.evaluate(frame);
    }
    throw new Error(`Browser condition did not settle: ${expression}`);
}

async function mouse(view: View, selector: string | null, click = false): Promise<void> {
    const point =
        selector === null
            ? { x: 790, y: 590 }
            : await view.evaluate<{ x: number; y: number }>(
                  `(()=>{const box=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})()`
              );
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    if (click) {
        await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
        await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    }
    await view.evaluate(frame);
}

async function execute(view: View, code: string): Promise<void> {
    await view.evaluate(`(() => { ${code} })()`);
}

async function key(view: View, key: string, code: string, virtualKey: number): Promise<void> {
    await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
    await view.evaluate(frame);
}

async function screenshot(view: View, name: string): Promise<void> {
    const directory = process.env.RUIMTE_CODE_ACTIONS_EVIDENCE;
    if (!directory) {
        return;
    }
    await mkdir(directory, { recursive: true });
    await view.evaluate(
        'Promise.allSettled(document.getAnimations().filter(animation=>animation.playState==="running"&&animation.effect.getComputedTiming().endTime<600).map(animation=>animation.finished))'
    );
    const result = (await view.cdp('Page.captureScreenshot', { format: 'png' })) as { data: string };
    await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

test('real Markdown copy actions retain exact text, focus, hover and scroll placement', async () => {
    await fixture(async (view) => {
        expect(await view.evaluate<number>('document.querySelectorAll("[data-inline] button").length')).toBe(0);
        expect(await view.evaluate<number>('document.querySelectorAll("button[aria-label=\\"Copy code\\"]").length')).toBe(3);
        await mouse(view, null);
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-plain] .chat-code-actions")).opacity')).toBe('0');
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-plain] .chat-code-actions")).pointerEvents')).toBe('none');
        const height = await view.evaluate<number>('document.querySelector("[data-plain] .chat-code").getBoundingClientRect().height');
        await screenshot(view, 'light-wide-rest');
        await mouse(view, '[data-plain] .chat-code');
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-plain] .chat-code-actions")).opacity')).toBe('1');
        expect(await view.evaluate<number>('document.querySelector("[data-plain] .chat-code").getBoundingClientRect().height')).toBe(height);
        await screenshot(view, 'light-wide-hover');
        await mouse(view, '[data-plain] button', true);
        expect(await view.evaluate<string[]>('window.copies')).toEqual([plain]);
        expect(await view.evaluate<string>('document.querySelector("[data-plain] button").getAttribute("aria-label")')).toBe('Copied');
        await view.evaluate('document.body.tabIndex=-1,document.body.focus()');
        await mouse(view, null);
        await key(view, 'Tab', 'Tab', 9);
        expect(await view.evaluate<boolean>('document.activeElement.closest("[data-plain]")!==null')).toBe(true);
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-plain] .chat-code-actions")).opacity')).toBe('1');
        await key(view, ' ', 'Space', 32);
        expect(await view.evaluate<string[]>('window.copies')).toEqual([plain, plain]);
        expect(await view.evaluate<boolean>('document.activeElement.closest("[data-plain]")!==null')).toBe(true);
        await view.evaluate('window.failCopy=true');
        await key(view, 'Enter', 'Enter', 13);
        await waitFor(view, 'document.querySelector("[data-plain] [role=alert]")!==null');
        expect(await view.evaluate<string>('document.querySelector("[data-plain] button").getAttribute("aria-label")')).toBe('Copy code');
        await view.evaluate('document.activeElement.blur()');
        await mouse(view, null);
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-plain] .chat-code-actions")).opacity')).toBe('1');
        await screenshot(view, 'light-copy-failure');
        await view.evaluate('document.querySelector("#examples").style.width="260px"');
        const before = await view.evaluate<number>('document.querySelector("[data-long] .chat-code-actions").getBoundingClientRect().right');
        expect(
            await view.evaluate<boolean>('document.querySelector("[data-long] pre").scrollWidth>document.querySelector("[data-long] pre").clientWidth')
        ).toBe(true);
        await execute(view, 'document.querySelector("[data-long] pre").scrollLeft=1000;document.querySelector("[data-long] button").focus()');
        expect(await view.evaluate<number>('document.querySelector("[data-long] .chat-code-actions").getBoundingClientRect().right')).toBe(before);
        expect(
            await view.evaluate<boolean>(
                'document.querySelector("[data-long] code").getBoundingClientRect().top<document.querySelector("[data-long] .chat-code-actions").getBoundingClientRect().bottom'
            )
        ).toBe(true);
        await screenshot(view, 'light-narrow-focus-scroll');
        await view.evaluate('window.changeTheme("dark")');
        await waitFor(view, 'document.querySelectorAll(".chat-code pre:not(.invisible)").length===3');
        await screenshot(view, 'dark-narrow-focus-scroll');
        await execute(view, 'window.failCopy=false;window.holdCopy=true');
        await key(view, 'Enter', 'Enter', 13);
        expect(await view.evaluate<string>('document.querySelector("[data-long] button").getAttribute("aria-busy")')).toBe('true');
        expect(await view.evaluate<string[]>('window.copies')).toEqual([plain, plain, plain, long]);
        await key(view, 'Enter', 'Enter', 13);
        expect(await view.evaluate<string[]>('window.copies')).toEqual([plain, plain, plain, long]);
        expect(await view.evaluate<boolean>('document.activeElement.closest("[data-long]")!==null')).toBe(true);
        await view.evaluate('window.releaseCopy()');
        await view.evaluate(frame);
    });
});

test('empty fences keep Copy in every Markdown renderer without adding controls to inline code', async () => {
    await fixture(async (view) => {
        await view.evaluate('window.showEmpty()');
        await view.evaluate(frame);
        expect(await view.evaluate<number>('document.querySelectorAll("[data-empty] .chat-code").length')).toBe(4);
        await waitFor(view, 'document.querySelectorAll("[data-empty] pre:not(.invisible)").length===4');
        for (const renderer of ['markdown', 'plain', 'message', 'assistant']) {
            const selector = `[data-empty="${renderer}"]`;
            expect(await view.evaluate<string>(`document.querySelector('${selector} code').textContent`)).toBe('');
            await view.evaluate(`document.querySelector('${selector} button').focus()`);
            await key(view, 'Enter', 'Enter', 13);
        }
        expect(await view.evaluate<string[]>('window.copies')).toEqual(['', '', '', '']);
        expect(await view.evaluate<number>('document.querySelectorAll("[data-inline] button").length')).toBe(0);
        await screenshot(view, 'empty-fences');
    });
});

test('touch targets remain fully inside a short code block and accept a lower-edge tap', async () => {
    await fixture(async (view) => {
        await execute(view, 'window.changeStreaming(false);document.querySelector("#examples").style.width="260px"');
        await waitFor(view, 'document.querySelector("[aria-label=\\"Prepare in terminal\\"]")!==null');
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        const targets = await view.evaluate<{ size: number; visibleHeight: number; visibleWidth: number; x: number; y: number }[]>(`(()=>{
            const block=document.querySelector('[data-shell] .chat-code').getBoundingClientRect();
            return [...document.querySelectorAll('[data-shell] button')].map(button=>{
                const box=button.getBoundingClientRect();
                const inset=-parseFloat(getComputedStyle(button,'::after').top);
                return {size:box.height+2*inset,
                    visibleHeight:Math.min(box.bottom+inset,block.bottom-1)-Math.max(box.top-inset,block.top+1),
                    visibleWidth:Math.min(box.right+inset,block.right-1)-Math.max(box.left-inset,block.left+1),
                    x:box.x+box.width/2,y:box.bottom+6};
            });
        })()`);
        expect(targets).toHaveLength(2);
        for (const target of targets) {
            expect(target.size).toBe(44);
            expect(target.visibleHeight).toBe(44);
            expect(target.visibleWidth).toBe(44);
        }
        const { x, y } = targets[0]!;
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await view.evaluate(frame);
        expect(await view.evaluate<string[]>('window.copies')).toEqual(['printf ready']);
        await screenshot(view, 'touch-lower-edge');
    });
});

test('real host renders the terminal icon only for complete eligible main replies', async () => {
    await fixture(async (view) => {
        expect(await view.evaluate<boolean>('document.querySelector("[aria-label=\\"Prepare in terminal\\"]")===null')).toBe(true);
        await execute(
            view,
            `window.firstLine=document.querySelector('[data-shell] code .line');
            const range=document.createRange();range.selectNodeContents(window.firstLine);getSelection().removeAllRanges();getSelection().addRange(range);window.changeStreaming(false);`
        );
        await waitFor(view, 'document.querySelector("[aria-label=\\"Prepare in terminal\\"]")!==null');
        expect(await view.evaluate<boolean>('window.firstLine===document.querySelector("[data-shell] code .line")')).toBe(true);
        expect(await view.evaluate<string>('getSelection().toString()')).toBe('printf ready');
        expect(
            await view.evaluate<boolean>(
                'document.querySelector("[aria-label=\\"Prepare in terminal\\"]").parentElement===document.querySelector("[data-shell] .chat-code-actions")'
            )
        ).toBe(true);
        await mouse(view, '[data-shell] .chat-code');
        await screenshot(view, 'light-shell-hover');
        await view.evaluate('window.changeTheme("dark")');
        await waitFor(view, 'document.querySelectorAll(".chat-code pre:not(.invisible)").length===3');
        await screenshot(view, 'dark-wide-hover');
        await view.evaluate('window.useFallback()');
        await waitFor(
            view,
            'document.querySelectorAll(".chat-code pre:not(.invisible)").length===3&&document.querySelectorAll(".chat-code code .line").length===0'
        );
        expect(await view.evaluate<boolean>('document.querySelector("[aria-label=\\"Prepare in terminal\\"]").closest(".invisible")===null')).toBe(true);
        await view.evaluate('document.querySelector("[aria-label=\\"Prepare in terminal\\"]").focus()');
        await key(view, 'Enter', 'Enter', 13);
        await waitFor(view, 'document.body.textContent.includes("The machine of this chat is not connected.")');
        await mouse(view, null);
        expect(await view.evaluate<boolean>('document.body.textContent.includes("The machine of this chat is not connected.")')).toBe(true);
        await view.evaluate('window.changeText("```bash\\none\\ntwo\\n```")');
        await view.evaluate(frame);
        expect(await view.evaluate<boolean>('document.querySelector("[aria-label=\\"Prepare in terminal\\"]")===null')).toBe(true);
        await view.evaluate('window.changeText("```bash\\nprintf unfinished")');
        await view.evaluate(frame);
        expect(await view.evaluate<boolean>('document.querySelector("[aria-label=\\"Prepare in terminal\\"]")===null')).toBe(true);
        await execute(view, `window.changeText(${JSON.stringify(shell)});window.changeChild(true)`);
        await view.evaluate(frame);
        expect(await view.evaluate<boolean>('document.querySelector("[aria-label=\\"Prepare in terminal\\"]")===null')).toBe(true);
        await execute(view, `window.changeChild(false);window.changeTheme('dark');document.querySelector('#examples').style.width='260px';`);
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await view.evaluate('document.activeElement.blur()');
        await mouse(view, null);
        expect(await view.evaluate<boolean>('matchMedia("(hover: none)").matches')).toBe(true);
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-shell] .chat-code-actions")).opacity')).toBe('1');
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-shell] button"),"::after").width')).toBe('44px');
        const point = await view.evaluate<{ x: number; y: number }>(
            '(()=>{const box=document.querySelector("[data-shell] button").getBoundingClientRect();return {x:box.x-4,y:box.y+box.height/2};})()'
        );
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await waitFor(view, 'window.copies.length===1');
        expect(await view.evaluate<string[]>('window.copies')).toEqual(['printf ready']);
        await screenshot(view, 'dark-narrow-touch');
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        await view.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector("[data-shell] button")).transitionDuration')).toBe('0s');
        await execute(
            view,
            'window.changeTheme("light");document.querySelector("#examples").style.transform="scale(.8)";document.querySelector("#examples").style.transformOrigin="top left"'
        );
        await mouse(view, '[data-shell] .chat-code');
        expect(
            await view.evaluate<boolean>(
                'document.querySelector("[data-shell] .chat-code-actions").getBoundingClientRect().right<=document.querySelector("[data-shell] .chat-code").getBoundingClientRect().right'
            )
        ).toBe(true);
        await screenshot(view, 'light-canvas-zoom');
        await view.evaluate('window.changeLanguage("nl")');
        await waitFor(view, 'document.querySelector("[aria-label=\\"Klaarzetten in terminal\\"]")!==null');
        expect(await view.evaluate<boolean>('document.querySelector("[aria-label=\\"Code kopiëren\\"]")!==null')).toBe(true);
    });
});
