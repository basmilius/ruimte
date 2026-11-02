// @bun
// Generated from apps/server/src/extensions/server-runtime.ts by apps/server/scripts/generate-extension-runtimes.ts. Do not edit.
// apps/server/src/extensions/server-runtime.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

// packages/contracts/src/extension-permissions.ts
var EXTENSION_ACTIONS = {
  "launch.list": "launches.read",
  "launch.read": "launches.read",
  "launch.start": "launches.run",
  "launch.restart": "launches.run",
  "launch.stop": "launches.run",
  "routine.list": "routines.read",
  "routine.run": "routines.run",
  "routine.pause": "routines.run",
  "routine.resume": "routines.run",
  "artifact.list": "artifacts.read",
  "artifact.read": "artifacts.read",
  "artifact.publish": "artifacts.write",
  "browser.inspect": "browser.control",
  "browser.navigate": "browser.control",
  "browser.back": "browser.control",
  "browser.forward": "browser.control",
  "browser.reload": "browser.control",
  "browser.screenshot": "browser.control",
  "device.list": "devices.control",
  "device.inspect": "devices.control",
  "device.screenshot": "devices.control",
  "device.tap": "devices.control",
  "device.launch": "devices.control"
};

// packages/contracts/src/extension-client.ts
var MACHINE_AREAS = {
  launch: "launches",
  routine: "routines",
  artifact: "artifacts",
  browser: "browser",
  device: "devices"
};
function extensionActionCall(action) {
  const dot = action.indexOf(".");
  return `${MACHINE_AREAS[action.slice(0, dot)] ?? action.slice(0, dot)}${action.slice(dot)}`;
}
var EXTENSION_CLIENT_PERMISSIONS = {
  "files.readText": "files.read",
  "files.write": "files.write",
  "files.list": "files.read",
  "files.watch": "files.read",
  "git.status": "git.read",
  "git.diff": "git.read",
  "git.log": "git.read",
  "terminals.read": "terminals.read",
  "terminals.open": "canvas.write",
  "database.connections": "database.read",
  "database.query": "database.read",
  "chats.list": "chats.read",
  "chats.read": "chats.read",
  "chats.send": "chats.send",
  "views.createCanvas": "views.write",
  "views.rename": "views.write",
  "context.read": "context.read",
  "agents.run": "agents.run",
  "agents.stream": "agents.run",
  "agents.start": "agents.start",
  "canvas.createNote": "canvas.write",
  "canvas.createFile": "canvas.write",
  "canvas.createBrowser": "canvas.write",
  "canvas.createNode": "canvas.write",
  "canvas.update": "canvas.write",
  "canvas.writeNote": "canvas.write",
  "canvas.arrange": "canvas.write",
  "canvas.remove": "canvas.write",
  "canvas.group": "canvas.write",
  "canvas.link": "canvas.write",
  "canvas.unlink": "canvas.write",
  useAgents: "agents.status",
  useUsageLimits: "usage.read",
  ...Object.fromEntries(Object.entries(EXTENSION_ACTIONS).map(([action, permission]) => [extensionActionCall(action), permission]))
};

// apps/server/src/extensions/policy.ts
var STORAGE_ASKS = new Set(["storage.get", "storage.set", "storage.delete"]);
var SCHEDULE_NEEDS_CLOCK = "schedule needs the permission clock in manifest.json";
var UNITS = { s: 1000, m: 60000, h: 3600000 };
var MIN_EVERY_MS = 1e4;
var MAX_EVERY_MS = 2 ** 31 - 1;
function everyMs(every) {
  const match = /^(\d+)([smh])$/.exec(every);
  const ms = match === null ? 0 : Number(match[1]) * UNITS[match[2]];
  if (!Number.isFinite(ms) || ms < MIN_EVERY_MS || ms > MAX_EVERY_MS) {
    throw new Error(`schedule takes something like 30s, 5m or 1h, of at least 10 seconds and at most 596h, not ${every}`);
  }
  return ms;
}

// apps/server/src/extensions/server-api.ts
class MissingHandler extends Error {
}
function mapResult(result, next) {
  return result.ok ? { ok: true, value: next(result.value) } : result;
}
function callHandler(handlers, method, args) {
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (typeof handler !== "function") {
    throw new MissingHandler(`No method ${method}`);
  }
  return handler(...args);
}
function createServerApi(options) {
  const { ask, send, permissions } = options;
  const listeners = new Map;
  const tools = new Map;
  const nodeContexts = new Map;
  const typed = (method, args) => ask(method, args);
  const server = {
    machine: {
      platform: options.platform,
      dataFolder: options.dataFolder,
      run: (project, action, input) => typed("action", [project.id, action, input ?? {}])
    },
    defineLanguageServer: async (languageServer) => mapResult(await ask("languages.add", [languageServer]), () => {
      return;
    }),
    agents: {
      run: (runOptions) => typed("agents.run", [runOptions]),
      async start({
        project,
        view,
        near,
        prompt,
        provider,
        title
      }) {
        const beside = near?.[0]?.id;
        const started = await typed("agents.start", [
          {
            projectId: project.id,
            ...view === undefined ? {} : { viewId: view.id },
            ...beside === undefined ? {} : { beside },
            ...prompt === undefined ? {} : { prompt },
            ...provider === undefined ? {} : { provider },
            ...title === undefined ? {} : { title }
          }
        ]);
        return mapResult(started, ({ nodeId }) => ({ id: nodeId }));
      }
    },
    chats: {
      list: () => typed("chats.list", []),
      read: (chatId) => typed("chats.read", [chatId]),
      send: async (chatId, text) => mapResult(await ask("chats.send", [chatId, text]), () => {
        return;
      })
    },
    defineAgentTool(tool) {
      tools.set(tool.id, tool);
      send({ type: "tool", name: tool.id, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} } });
    },
    schedule(task) {
      if (!permissions.has("clock")) {
        throw new Error(SCHEDULE_NEEDS_CLOCK);
      }
      options.clock.every(everyMs(task.every), () => (async () => {
        await task.run();
      })().catch((e) => options.log.error(`${task.id} failed:`, e)));
    },
    defineServer: (api) => api,
    onEvent(name, listener) {
      const group = listeners.get(name) ?? new Set;
      const heard = listener;
      group.add(heard);
      listeners.set(name, group);
      send({ type: "subscribe", name });
      return () => {
        group.delete(heard);
      };
    },
    emit(name, payload) {
      send({ type: "emit", name, payload });
    },
    defineNodeContext(nodeType, read) {
      nodeContexts.set(nodeType, read);
    },
    storage: {
      get: async (key) => await options.storage.get(key),
      set: (key, value) => options.storage.set(key, value),
      delete: (key) => options.storage.delete(key)
    },
    secrets: {
      get: async (key) => await options.secrets.get(key),
      set: (key, value) => options.secrets.set(key, value)
    },
    log: options.log
  };
  return {
    server,
    runTool(name, input, context) {
      const tool = tools.get(name);
      if (tool === undefined) {
        throw new MissingHandler(`No tool ${name}`);
      }
      return tool.run(input, context);
    },
    readNodeContext: (nodeType, data) => nodeContexts.get(nodeType)?.({ data }) ?? [],
    deliver(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        listener(payload);
      }
    }
  };
}

// apps/server/src/extensions/server-runtime.ts
var [entry, dataFolder] = process.argv.slice(2);
if (entry === undefined || dataFolder === undefined) {
  throw new Error("Expected the extension entry and its data folder");
}
var folder = dataFolder;
var protocol = process.stdout;
function send(message) {
  protocol.write(`${JSON.stringify(message)}
`);
}
console.log = (...args) => console.error(...args);
console.info = console.log;
var asked = new Map;
var nextAsk = 1;
function ask(method, args) {
  const id = nextAsk;
  nextAsk += 1;
  return new Promise((resolve, reject) => {
    asked.set(id, { resolve, reject });
    send({ type: "ask", id, method, args });
  });
}
function jsonFile(name) {
  try {
    return JSON.parse(readFileSync(join(folder, name), "utf8"));
  } catch {
    return {};
  }
}
function writeJsonFile(name, value) {
  const file = join(folder, name);
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(folder, { recursive: true });
  writeFileSync(temporary, JSON.stringify(value), { mode: 384 });
  renameSync(temporary, file);
}
function secretValues() {
  const name = "secrets.json";
  return {
    get: async (key) => jsonFile(name)[key],
    set: async (key, value) => writeJsonFile(name, { ...jsonFile(name), [key]: value }),
    async delete(key) {
      const { [key]: _gone, ...rest } = jsonFile(name);
      writeJsonFile(name, rest);
    }
  };
}
function storageValues() {
  const asking = async (method, args) => {
    const answer = await ask(method, args);
    if (!answer.ok) {
      throw new Error(answer.error.message);
    }
    return answer.value;
  };
  return {
    get: async (key) => (await asking("storage.get", [key])).value,
    set: async (key, value) => void await asking("storage.set", [key, value]),
    delete: async (key) => void await asking("storage.delete", [key])
  };
}
var core = createServerApi({
  dataFolder: folder,
  platform: process.platform,
  permissions: new Set(JSON.parse(process.env.RUIMTE_EXTENSION_PERMISSIONS ?? "[]")),
  ask,
  clock: { every: (ms, run) => void setInterval(run, ms) },
  send,
  storage: storageValues(),
  secrets: secretValues(),
  log: {
    info: (message) => console.error(message),
    error: (message, error) => console.error(message, error ?? "")
  }
});
globalThis.__ruimteExtension = {
  for: () => ({ server: core.server })
};
var { promise: loaded, resolve: resolveLoaded } = Promise.withResolvers();
async function answer(id, run) {
  try {
    send({ type: "result", id, result: await run() ?? null });
  } catch (e) {
    send({ type: "result", id, error: e instanceof Error ? e.message : String(e), ...e instanceof MissingHandler ? { code: "not-found" } : {} });
  }
}
function handle(message) {
  if (message.type === "answer") {
    const waiting = asked.get(message.id);
    const { result, error, code = "failed" } = message;
    asked.delete(message.id);
    if (error === undefined) {
      waiting?.resolve({ ok: true, value: result });
    } else if (code === "invalid-input") {
      waiting?.reject(new TypeError(error));
    } else {
      waiting?.resolve({ ok: false, error: { code, message: error } });
    }
  } else if (message.type === "call") {
    answer(message.id, async () => callHandler(await loaded, message.method, message.args));
  } else if (message.type === "event") {
    core.deliver(message.name, message.payload);
  } else if (message.type === "tool") {
    answer(message.id, async () => {
      await loaded;
      return core.runTool(message.method, message.payload, message.context);
    });
  } else if (message.type === "nodeContext") {
    answer(message.id, async () => {
      await loaded;
      return core.readNodeContext(message.node, message.data);
    });
  }
}
var buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  for (let end = buffered.indexOf(`
`);end >= 0; end = buffered.indexOf(`
`)) {
    const line = buffered.slice(0, end);
    buffered = buffered.slice(end + 1);
    handle(JSON.parse(line));
  }
});
var module = await import(entry);
resolveLoaded(module.default ?? {});
send({ type: "ready" });
