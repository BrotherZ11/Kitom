import { Banner } from '@/components/ui/banner';
import { WifiOff } from '@/components/ui/icons';
import { formatSavedAt, type PetFreshness } from '@/features/pets/offline/pet-view';
import { getLocale, t, tf } from '@/i18n';

/**
 * Aviso de datos de mascotas que pueden estar desactualizados: sin conexión o sin sesión utilizable,
 * con la copia del dispositivo o con lo último cargado en esta sesión, y cuándo se actualizó. Con
 * datos al día no ocupa sitio.
 */
export function PetSavedBanner({ freshness }: { freshness: PetFreshness | null | undefined }) {
  if (!freshness?.stale) return null;
  const date = formatSavedAt(freshness.savedAt, getLocale());
  return (
    <Banner
      tone="warning"
      icon={WifiOff}
      message={date ? tf('pets.offline.savedBannerAt', { date }) : t('pets.offline.savedBanner')}
    />
  );
}
