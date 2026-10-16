import { Alert } from '@/components/ui/alert';

type FormMessageProps = {
  message: string | null;
  tone?: 'error' | 'success';
};

/**
 * Resultado de un formulario o una acción (no de un campo concreto: para eso, `error` del campo).
 * Alerta de error o de éxito; se anuncia a lectores de pantalla.
 */
export function FormMessage({ message, tone = 'error' }: FormMessageProps) {
  if (!message) return null;
  return <Alert tone={tone} message={message} />;
}
