import { cases as agents } from './agents.cases.ts';
import { cases as canvas } from './canvas.cases.ts';
import type { WriteCases, WriteDomain } from './case.ts';
import { cases as communicate } from './communicate.cases.ts';
import { cases as content } from './content.cases.ts';
import { cases as developer } from './developer.cases.ts';
import { cases as files } from './files.cases.ts';
import { cases as layout } from './layout.cases.ts';
import { cases as machine } from './machine.cases.ts';
import { cases as pages } from './pages.cases.ts';
import { cases as plans } from './plans.cases.ts';
import { cases as projects } from './projects.cases.ts';
import { cases as sessions } from './sessions.cases.ts';
import { cases as views } from './views.cases.ts';

export const WRITE_CASES: Record<WriteDomain, WriteCases> = {
    agents,
    canvas,
    communicate,
    content,
    developer,
    files,
    layout,
    machine,
    pages,
    plans,
    projects,
    sessions,
    views
};
