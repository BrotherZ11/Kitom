import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

/**
 * Confirmar antes de salir de una pantalla con cambios sin guardar (tablero 5.7): cubre la X o
 * «Volver» propios, el botón «atrás» del sistema y el gesto de cerrar. Mientras `dirty` sea `false`,
 * salir no pregunta nada. `allowLeave()` desactiva la pregunta (p. ej. justo después de guardar).
 */
export function useLeaveConfirmation(dirty: boolean) {
  const navigation = useNavigation();
  const guard = useRef({ dirty, allowed: false });
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    guard.current.dirty = dirty;
  }, [dirty]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!guard.current.dirty || guard.current.allowed) return;
        event.preventDefault();
        setPending(() => () => {
          guard.current.allowed = true;
          navigation.dispatch(event.data.action);
        });
      }),
    [navigation]
  );

  return {
    /** Hay una salida esperando a que el usuario confirme. */
    visible: pending !== null,
    /** Seguir en la pantalla. */
    stay: () => setPending(null),
    /** Salir sin guardar. */
    leave: () => {
      const action = pending;
      setPending(null);
      action?.();
    },
    allowLeave: () => {
      guard.current.allowed = true;
    },
  };
}
