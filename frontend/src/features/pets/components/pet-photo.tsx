import { Avatar } from '@/components/ui/avatar';
import { usePetPhotoUrl } from '@/features/pets/hooks/use-pet-photo';
import { t } from '@/i18n';

type PetPhotoProps = {
  name: string;
  photoPath: string | null;
  /** Tamaño del avatar (32/40/64/96 o píxeles). */
  size: 'sm' | 'md' | 'lg' | 'xl' | number;
  /** URI local (foto elegida aún sin guardar); tiene prioridad sobre la foto guardada. */
  previewUri?: string | null;
};

/**
 * Foto de la mascota desde el bucket privado `pet-photos` (URL firmada bajo demanda). Sin foto, o si
 * no se puede firmar, la inicial del nombre sobre `surface-warm` (tableros 3.x y 4.x). Subir, cambiar
 * o quitar: `PetPhotoSheet`.
 */
export function PetPhoto({ name, photoPath, size, previewUri = null }: PetPhotoProps) {
  const { data: url } = usePetPhotoUrl(previewUri ? null : photoPath);

  if (previewUri) {
    return (
      <Avatar name={name} size={size} source={{ uri: previewUri }} accessibilityLabel={`${t('pets.photo.preview')}: ${name}`} />
    );
  }

  return (
    <Avatar
      name={name}
      size={size}
      tone="warm"
      // La caché de imagen va por path: renovar la URL firmada no vuelve a descargar la foto.
      source={url && photoPath ? { uri: url, cacheKey: photoPath } : null}
      accessibilityLabel={`${t('pets.fields.photo')}: ${name}`}
    />
  );
}
