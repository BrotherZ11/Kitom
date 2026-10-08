/**
 * Reglas de las fotos de mascota (bucket privado `pet-photos`). Decisión y límites: `docs/DECISIONS.md`.
 *
 * Path: `{pet_id}/{uuid}.jpg`. El primer segmento es el `pet_id` porque las políticas de Storage
 * autorizan con `can_edit_pet` / `is_pet_member(safe_pet_id_from_path(name))`. El uuid hace cada
 * subida única: el bucket no tiene política UPDATE, así que no se sobrescribe; se sube un objeto
 * nuevo y se borra el anterior.
 */

export const PET_PHOTOS_BUCKET = 'pet-photos';

/** Formatos de entrada aceptados (galería/cámara). GIF y el resto se rechazan. */
export const ACCEPTED_INPUT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Formato de salida único: JPEG, compatible con Android, iOS, web y proveedores de IA. */
export const PET_PHOTO_MIME_TYPE = 'image/jpeg';
export const PET_PHOTO_EXTENSION = 'jpg';

/** Lado mayor máximo tras redimensionar. Suficiente para perfil y para un análisis de imagen. */
export const PET_PHOTO_MAX_DIMENSION = 1600;

/** Calidad JPEG (0–1). 0.8 reduce mucho el peso sin artefactos visibles. */
export const PET_PHOTO_JPEG_QUALITY = 0.8;

/** Tamaño máximo del archivo original: evita decodificar archivos enormes en el dispositivo. */
export const PET_PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Tamaño máximo del JPEG final que se sube (habitualmente 200–800 KB). */
export const PET_PHOTO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Duración de la URL firmada para mostrar la foto. */
export const PET_PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Foto ya validada, redimensionada y comprimida, lista para subir. */
export type PreparedPetPhoto = {
  /** URI local para la previsualización. */
  uri: string;
  bytes: ArrayBuffer;
  mimeType: typeof PET_PHOTO_MIME_TYPE;
  extension: typeof PET_PHOTO_EXTENSION;
  width: number;
  height: number;
};

export function isAcceptedInputMimeType(mimeType: string): boolean {
  return (ACCEPTED_INPUT_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/**
 * UUID v4 para el nombre del objeto. No es un secreto (el acceso lo decide RLS) y una colisión
 * haría fallar la subida (sin upsert), nunca sobrescribir otra foto.
 */
function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function buildPetPhotoPath(petId: string): string {
  return `${petId}/${randomUuid()}.${PET_PHOTO_EXTENSION}`;
}

/** Solo se borran objetos de la carpeta de la propia mascota. */
export function isPetPhotoPathOf(petId: string, photoPath: string): boolean {
  return photoPath.startsWith(`${petId}/`);
}
