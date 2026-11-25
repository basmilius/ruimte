import type { AgentKind, RoutineSkillsResult } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { machineTransport } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';

type Skills = RoutineSkillsResult['skills'];

const NONE: Skills = [];

/*
 * The skills the routine's agent would run in its project on this machine, on its account or the default one;
 * none from a machine that cannot say.
 */
export function useRoutineSkills(endpointId: string, projectId: string, provider: AgentKind | null, account: string | undefined): Skills {
    const answers = useMachineAnswers(endpointId, 'routine.skills');
    const [found, setFound] = useState<{ key: string; skills: Skills } | null>(null);
    const key = `${projectId}\n${provider ?? ''}\n${account ?? ''}`;

    useEffect(() => {
        if (!answers || provider === null) {
            return;
        }
        let stale = false;
        void fireAndForget(
            'routine.skills',
            machineTransport(endpointId)
                .request('routine.skills', { projectId, provider, ...(account === undefined ? {} : { account }) })
                .then(({ skills }) => {
                    if (!stale) {
                        setFound({ key: `${projectId}\n${provider}\n${account ?? ''}`, skills });
                    }
                })
        );
        return () => {
            stale = true;
        };
    }, [account, answers, endpointId, projectId, provider]);

    // A list read for another agent or project is not this one's.
    return found?.key === key ? found.skills : NONE;
}
