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

const pinoLogger = pino(transport);

export const logger = {
    info: (module: string, message: string) => {
        pinoLogger.info({ module }, message);
    },
    warn: (module: string, message: string) => {
        pinoLogger.warn({ module }, message);
    },
    error: (module: string, message: string) => {
        pinoLogger.error({ module }, message);
    },
    system: (module: string, message: string) => {
        pinoLogger.info({ module, system: true }, message);
    },
};
