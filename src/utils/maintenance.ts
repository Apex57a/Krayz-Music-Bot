import { logger } from './logger';

let globalMaintenance = false;

export function isMaintenance(): boolean {
    return globalMaintenance;
}

export function setMaintenance(status: boolean): void {
    globalMaintenance = status;
    logger.info('system', `Global maintenance mode set to: ${status}`);
}
