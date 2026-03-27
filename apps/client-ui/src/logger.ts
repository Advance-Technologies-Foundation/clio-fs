import { EventEmitter } from "node:events";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  audit?: boolean;
  [key: string]: unknown;
}

export interface Logger {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
  subscribe: (handler: (entry: LogEntry) => void) => () => void;
  getRecent: (limit?: number) => LogEntry[];
}

const MAX_BUFFER_SIZE = 500;

export const createLogger = (): Logger => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  const buffer: LogEntry[] = [];

  const log = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields
    };

    process.stderr.write(`${JSON.stringify(entry)}\n`);

    buffer.push(entry);
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    emitter.emit("entry", entry);
  };

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
    subscribe(handler) {
      emitter.on("entry", handler);
      return () => emitter.off("entry", handler);
    },
    getRecent: (limit = 200) => buffer.slice(-limit)
  };
};

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  subscribe: () => () => {},
  getRecent: () => []
};
