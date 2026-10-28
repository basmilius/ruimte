# Transport

- A link to a machine opens only for a hold and closes 30 s after the last one (`connections.ts`). Holds are: `remote-holds.ts` for the machines the open project's nodes run on, `ensureMachine`, an open machine detail in settings or the usage page, and this machine while the desktop app shows the start screen. Nothing else opens one: not lists, status dots, auto-registration or limit bars. Clients sit on `machineTransport(id)`, which never opens a link.
- A node with its own `machine` draws from that machine. `NodeMachineScope` (`node-machine.tsx`) gives its frame that machine's transport and clients; the project, drawings and diagrams stay the workspace's. Code without a subtree to ask uses `endpointOfNodeId` (`state/node-endpoint.ts`).
