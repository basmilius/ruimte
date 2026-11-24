import { Heatmap, Sparkline } from '@ruimte/extension/charts';
import { useAgents, useServer, useStorage, useUsageLimits } from '@ruimte/extension/client';
import { Button } from '@ruimte/extension/ui';
import type { PulseboardServer } from '../server/index';

const GOAL = 'goal';
const GOAL_STEP = 5;

export default function ActivityView() {
    const server = useServer<PulseboardServer>();
    const history = server.history.use();
    const agents = useAgents();
    const limits = useUsageLimits();
    const [finished] = useStorage('finished', 0);
    const [goal, setGoal] = useStorage(GOAL, 20, 'project');
    // Written by `server/` as it counts, under the same keys.
    const [chatTurns] = useStorage('chatTurns', 0, 'machine');
    const [terminalTurns] = useStorage('terminalTurns', 0, 'machine');
    const working = agents.filter((agent) => agent.status === 'running').length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16, padding: 16 }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong>Now</strong>
                <span>
                    {working} of {agents.length} agents work
                </span>
                <span>
                    This machine started {chatTurns} turns in chats and {terminalTurns} in terminals
                </span>
                <span>{finished} turns ended while this computer watched</span>
            </section>
            <section style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Goal for this project: {goal} turns a day</span>
                <Button onClick={() => setGoal(Math.max(GOAL_STEP, goal - GOAL_STEP))}>Fewer</Button>
                <Button onClick={() => setGoal(goal + GOAL_STEP)}>More</Button>
            </section>
            {history.ok ? (
                <>
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <strong>Turns a day, the last two weeks</strong>
                        <Sparkline values={history.value.turns} kind="bars" label="Turns a day over the last two weeks" width={320} height={64} />
                        <span style={{ color: 'var(--text-muted)' }}>
                            {history.value.turns.filter((turns) => turns >= goal).length} of {history.value.turns.length} days reached the goal
                        </span>
                    </section>
                    <section style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'stretch' }}>
                        <strong>When the work happens</strong>
                        <Heatmap
                            rows={history.value.days.map((day) => ({ key: day, label: day }))}
                            columns={history.value.parts.map((part) => ({ key: part, label: part }))}
                            values={history.value.byPart}
                            label="Turns by day of the week and part of the day"
                            valueLabel="Turns"
                        />
                    </section>
                </>
            ) : (
                <span style={{ color: 'var(--text-muted)' }}>{history.error.message}</span>
            )}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong>Plan windows</strong>
                {limits.length === 0 && <span style={{ color: 'var(--text-muted)' }}>No plan window yet.</span>}
                {limits.flatMap((limit) =>
                    limit.windows.map((window) => (
                        <span key={`${limit.provider}/${window.label}`}>
                            {limit.provider}, {window.label}: {Math.round(window.used * 100)}%
                        </span>
                    ))
                )}
            </section>
        </div>
    );
}
