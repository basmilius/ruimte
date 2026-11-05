import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { clientDirectory, frame, waitInPage, warmBrowserFixture, withBrowserFixture } from '../../testing/browser-fixture';

const assets = join(clientDirectory, 'dist/assets');
const sheets = (await readdir(assets)).filter((name) => name.endsWith('.css'));
const styles = (await Promise.all(sheets.map((name) => readFile(join(assets, name), 'utf8')))).join('\n') + '#root{width:1200px;height:1600px}';
const resolve = (name: string) => JSON.stringify(Bun.resolveSync(name, clientDirectory));
const entry = `
        import { Timeline } from ${resolve('@adecore/agents-react/chat/ui')};
        import { ChatHostProvider, ChatScopeContext } from ${resolve('@adecore/agents-react')};
        import { useChats } from ${resolve('@adecore/agents-react/state')};
        import words from ${resolve('@adecore/agents-react/locales/en/agent-chat')};
        i18next.addResourceBundle('en','agent-chat',words,true,true);
        const scope={id:'test',keyOf:id=>'test/'+id,owns:key=>key.startsWith('test/'),transport:{},chats:{loadEarlier:async()=>{}}};
        const info={chatId:'chat',provider:'claude',cwd:'/project',selection:{model:'model'},status:'running',running:true,activeTurnId:'turn',usage:{turns:1},background:[],slashCommands:[]};
        const items=[{kind:'turn',id:'turn',turnId:'turn',createdAt:1,state:'running'}, ...Array.from({length:12},(_,index)=>({kind:index===0?'user':'assistant',id:'message-'+index,turnId:'turn',createdAt:index+2,text:'Message '+index,streaming:index===11}))];
        useChats.getState().reset('test/chat',info,items);
        window.grow=()=>useChats.getState().apply('test/chat',{type:'delta',itemId:'message-11',text:'\\n\\nMore text in the response that is being written.'});
        window.historyCount=()=>useChats.getState().byKey['test/chat'].order.length;
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ChatHostProvider host={{}}><ChatScopeContext.Provider value={scope}><div className="chat-column flex h-full w-full flex-col"><div className="relative flex h-full flex-col bg-surface"><Timeline chatId="chat" composer={<div style={{height:100}}>Composer</div>}/></div></div></ChatScopeContext.Provider></ChatHostProvider></UIProvider>);
        `;

await warmBrowserFixture(entry, styles);

test('streaming keeps older messages visible while the chat fits without scrolling', async () => {
    await withBrowserFixture(entry, styles, async (view) => {
        await view.resize(1200, 1600);
        await waitInPage(view, `document.querySelector('[data-item-id="message-11"]')!==null`);
        await view.evaluate(frame);
        for (let index = 0; index < 13; index++) {
            await view.evaluate('window.grow()');
            await view.evaluate(frame);
            const layout = await view.evaluate<{ top: number; height: number; viewport: number; visible: boolean }>(`(()=>{
                    const scroller=document.querySelector('.chat-scroll');
                    const first=document.querySelector('[data-item-id="message-0"]');
                    const viewport=scroller.getBoundingClientRect();
                    const row=first?.getBoundingClientRect();
                    return {top:scroller.scrollTop,height:scroller.scrollHeight,viewport:scroller.clientHeight,visible:!!row&&row.top>=viewport.top&&row.bottom<=viewport.bottom};
                })()`);
            expect(layout.height).toBe(layout.viewport);
            expect(layout.top).toBe(0);
            expect(layout.visible, JSON.stringify({ index, ...layout })).toBe(true);
        }
        expect(await view.evaluate<number>('window.historyCount()')).toBe(13);
        expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
    });
});
