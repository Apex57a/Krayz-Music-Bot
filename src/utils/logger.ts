import pino from 'pino';

const transport = pino.transport({
    targets: [
        {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname,module',
                messageFormat: '[{module}] {msg}',
            },
        },
        {
            target: 'pino/file',
            options: {
                destination: './logs.txt',
                mkdir: true,
            },
        },
    ],
});

const pinoLogger = pino(
    {
        redact: {
            paths: [
                'token',
                'password',
                'secret',
                'authorization',
                '*.token',
                '*.password',
                '*.secret',
            ],
            censor: '[REDACTED]',
        },
    },
    transport,
);

export const logger = {
    info: (module: string, message: string, meta?: Record<string, unknown>) => {
        pinoLogger.info({ module, ...meta }, message);
    },
    warn: (module: string, message: string, meta?: Record<string, unknown>) => {
        pinoLogger.warn({ module, ...meta }, message);
    },
    error: (module: string, message: string, meta?: Record<string, unknown>) => {
        pinoLogger.error({ module, ...meta }, message);
    },
    debug: (module: string, message: string, meta?: Record<string, unknown>) => {
        pinoLogger.debug({ module, ...meta }, message);
    },
    fatal: (module: string, message: string, meta?: Record<string, unknown>) => {
        pinoLogger.fatal({ module, ...meta }, message);
    },
    system: (module: string, message: string, meta?: Record<string, unknown>) => {
        pinoLogger.info({ module, system: true, ...meta }, message);
    },
};
