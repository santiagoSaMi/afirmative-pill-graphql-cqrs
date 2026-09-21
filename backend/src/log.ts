type Level = 'INFO' | 'WARN' | 'ERROR' | 'SQL';

function write(level: Level, scope: string, message: string, extra?: unknown) {
  const line =
    `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${message}` +
    (extra === undefined ? '' : ` ${JSON.stringify(extra)}`);
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

export const log = {
  info: (scope: string, message: string, extra?: unknown) => write('INFO', scope, message, extra),
  warn: (scope: string, message: string, extra?: unknown) => write('WARN', scope, message, extra),
  error: (scope: string, message: string, extra?: unknown) => write('ERROR', scope, message, extra),
  sql: (message: string) => write('SQL', 'sql', message),
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
