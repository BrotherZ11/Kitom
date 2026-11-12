import { useLocalSearchParams } from 'expo-router';

import { withServerPetId } from '@/features/pets/components/local-pet-logs-unavailable';
import { WellnessScreen } from '@/features/wellness/components/wellness-screen';

/** Resumen de bienestar de una mascota: vista `summary` (`features/wellness/`). Sin id del servidor, no hay registros. */
export default withServerPetId(function WellnessRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WellnessScreen petId={id} variant="summary" />;
});
