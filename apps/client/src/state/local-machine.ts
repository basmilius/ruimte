import { IS_STATION } from '@/station';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * Whether a daemon serves this page, which makes the row of "this machine" a machine at all. The
 * desktop app, a browser on `--serve` and the Vite dev origin all have one behind them; the web
 * client at station.ruimte.app never does, so its local row stays in the store for the code that
 * assumes it is there and is listed nowhere a person picks a machine.
 */
export const hasLocalMachine = (station: boolean = IS_STATION): boolean => !station;

/* The rows a list of machines shows: every row, without the local one where no daemon is behind it. */
export const listedEndpoints = <T extends Pick<Endpoint, 'id'>>(endpoints: readonly T[], local: boolean = hasLocalMachine()): T[] =>
    local ? [...endpoints] : endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID);

/* Whether the machine the client points at is one a person picked, rather than the idle local row of the web client. */
export const isRealMachine = (endpointId: string, local: boolean = hasLocalMachine()): boolean => local || endpointId !== LOCAL_ENDPOINT_ID;
