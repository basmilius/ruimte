import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { clientDirectory, withBrowserFixture } from '../../testing/browser-fixture';

type View = InstanceType<typeof Bun.WebView>;
const path = '/repo/a folder/a file.ts';
const markdown = `[Named source](</repo/a folder/a file.ts:12:4-16>) and \`/repo/a folder/a file.ts#L12C4-L16\``;
const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

async function fixture(run: (view: View) => Promise<void>): Promise<void> {
    await withBrowserFixture(
        `
        import { Markdown, MessageMarkdown } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/chat/ui/Markdown', clientDirectory))};
        import { FileLinkContext } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/chat/ui/file-links', clientDirectory))};
        import { TimelineMenuPopup } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/chat/ui/TimelineMenu', clientDirectory))};
        import { readTimelineTarget, EMPTY_TARGET } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/chat/logic/timeline-target', clientDirectory))};
        import { SubagentTimeline } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/chat/ui/SubagentTimeline', clientDirectory))};
        import { machineFor } from ${JSON.stringify(join(import.meta.dir, '../transport/connections.ts'))};
        import { ContextMenu } from ${JSON.stringify(Bun.resolveSync('@adecore/ui', clientDirectory))};
        import { connectWorkspaceChatHost } from ${JSON.stringify(join(import.meta.dir, 'workspace-host.ts'))};
        import { ChatScopeContext } from ${JSON.stringify(Bun.resolveSync('@adecore/agents-react/scope', clientDirectory))};
        import { chatScopeOf } from ${JSON.stringify(join(import.meta.dir, '../transport/chat-scope.ts'))};
        import { useFiles } from ${JSON.stringify(join(import.meta.dir, '../state/files.ts'))};
        import { useWindow } from ${JSON.stringify(join(import.meta.dir, '../state/window.ts'))};
        import { useProject } from ${JSON.stringify(join(import.meta.dir, '../state/project.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { useEndpoints } from ${JSON.stringify(join(import.meta.dir, '../state/endpoints.ts'))};
        window.files=useFiles; window.workspace=useWindow;
        useEndpoints.setState({activeId:'local',endpoints:[{id:'local',label:'Local'}]});
        useWindow.getState().show({kind:'workspace',workspace:{connection:{endpointId:'local'}}});
        useProject.setState({current:{folder:'/repo',projectId:'fixture'}});
        useDocument.getState().load({version:3,rev:1,name:'Files',color:'#000',views:[]},null);
        connectWorkspaceChatHost();
        machineFor('local').transport.request=async(type)=>{
            if(type==='chat.subagent') return {source:'claude-transcript',live:false,history:{cursor:null},context:{provider:'claude',cwd:'/repo/nested'},items:[
                {id:'child-reply',kind:'assistant',turnId:null,createdAt:0,text:'[Child](<a folder/a file.ts:12:4-16>)',streaming:false},
                {id:'child-user',kind:'user',turnId:null,createdAt:1,text:'@src/mention.ts',mentions:['src/mention.ts']}
            ]};
            return {};
        };
        function Fixture(){
            const thread=React.useRef(null); const [target,setTarget]=React.useState(EMPTY_TARGET);
            const [text,setText]=React.useState(${JSON.stringify(markdown)}); window.setText=setText;
            const [child,setChild]=React.useState(false);window.showChild=()=>setChild(true);
            if(child) return <SubagentTimeline chatId="parent" toolUseId="child"/>;
            return <ContextMenu.Root><ContextMenu.Trigger ref={thread} data-file-cwd="/repo" data-file-scope-id="local" onContextMenuCapture={event=>setTarget(readTimelineTarget(event.target,thread.current,[]))}>
                <div data-main><Markdown text={text}/></div><div data-mention><MessageMarkdown text="@src/mention.ts" mentions={["src/mention.ts"]}/></div>
                <TimelineMenuPopup target={target} thread={thread}/>
            </ContextMenu.Trigger></ContextMenu.Root>;
        }
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ChatScopeContext.Provider value={chatScopeOf("local")}><FileLinkContext.Provider value="/repo"><Fixture/></FileLinkContext.Provider></ChatScopeContext.Provider></UIProvider>);
    `,
        'svg{width:14px;height:14px}',
        async (view) => {
            await view.evaluate(frame);
            expect(await view.evaluate<number>('document.querySelectorAll("[data-file-path]").length')).toBe(3);
            await run(view);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}

async function click(view: View, selector: string, button: 'left' | 'right' = 'left'): Promise<void> {
    const point = await view.evaluate<{ x: number; y: number }>(
        `(() => {const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`
    );
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, buttons: 0, clickCount: 1 });
    await view.evaluate(frame);
}

test('chat markdown links and inline paths carry spaces, columns and ranges into file.preview', async () => {
    await fixture(async (view) => {
        await click(view, '[data-file-path]');
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toEqual({ key: path, line: 12, column: 4, endLine: 16, nonce: 1 });
        await click(view, '[data-main] [data-file-path]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toEqual({ key: path, line: 12, column: 4, endLine: 16, nonce: 2 });
        await view.evaluate(
            "(() => {window.files.setState({tabs:[],revealLine:null});window.workspace.getState().show({kind:'workspace',workspace:{connection:{endpointId:'remote'}}});})()"
        );
        await click(view, '[data-file-path]');
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
    });
});

test('a chat menu preserves the same complete location as a click', async () => {
    await fixture(async (view) => {
        await click(view, '[data-file-path]', 'right');
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toEqual({ key: path, line: 12, column: 4, endLine: 16, nonce: 1 });
    });
});

test('a captured chat menu cannot cross machines after a workspace switch', async () => {
    await fixture(async (view) => {
        await click(view, '[data-file-path]', 'right');
        await view.evaluate("window.workspace.getState().show({kind:'workspace',workspace:{connection:{endpointId:'remote'}}})");
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
    });
});

test('a mention chip opens from the timeline menu with its inherited origin', async () => {
    await fixture(async (view) => {
        await click(view, '[data-mention] [data-file-path]', 'right');
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().tabs.map(tab=>tab.path)')).toEqual(['/repo/src/mention.ts']);
    });
});

test('new local Markdown rendered after a machineswitch keeps its rendering owner for click and menu', async () => {
    await fixture(async (view) => {
        await view.evaluate(`(() => {
            window.workspace.getState().show({kind:'workspace',workspace:{connection:{endpointId:'remote'}}});
            window.setText('[Delayed](<src/delayed file.ts:12:4-16>)');
        })()`);
        await view.evaluate(frame);
        await click(view, '[data-file-path]');
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
        await click(view, '[data-file-path]', 'right');
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
        await view.evaluate("window.workspace.getState().show({kind:'workspace',workspace:{connection:{endpointId:'local'}}})");
        await click(view, '[data-file-path]');
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({
            key: '/repo/src/delayed file.ts',
            line: 12,
            column: 4,
            endLine: 16
        });
    });
});

test('a newly rendered subthread keeps the parent machine and its own cwd after a machineswitch', async () => {
    await fixture(async (view) => {
        await view.evaluate(`(() => {
            window.workspace.getState().show({kind:'workspace',workspace:{connection:{endpointId:'remote'}}});
            window.showChild();
        })()`);
        for (let attempt = 0; attempt < 60; attempt++) {
            if (await view.evaluate<boolean>('document.querySelector("[data-item-id=child-reply] [data-file-path]")!==null')) {
                break;
            }
            await view.evaluate(frame);
        }
        await click(view, '[data-item-id=child-reply] [data-file-path]');
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
        await click(view, '[data-item-id=child-user] [data-file-path]', 'right');
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
        await view.evaluate("window.workspace.getState().show({kind:'workspace',workspace:{connection:{endpointId:'local'}}})");
        await click(view, '[data-item-id=child-reply] [data-file-path]');
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({
            key: '/repo/nested/a folder/a file.ts',
            line: 12,
            column: 4,
            endLine: 16
        });
        await click(view, '[data-item-id=child-reply] [data-file-path]', 'right');
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({
            key: '/repo/nested/a folder/a file.ts',
            line: 12,
            column: 4,
            endLine: 16
        });
        await click(view, '[data-item-id=child-user] [data-file-path]', 'right');
        await click(view, '[role=menuitem]:last-child');
        expect(await view.evaluate<unknown>('window.files.getState().tabs.map(tab=>tab.path)')).toContain('/repo/nested/src/mention.ts');
    });
});
