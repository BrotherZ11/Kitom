import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);
const getSnapshot = () => onlineManager.isOnline();

/**
 * Señal de conectividad del sistema (`onlineManager`, ver `lib/connectivity.ts`). Indica si hay red,
 * no que el servidor vaya a responder.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
