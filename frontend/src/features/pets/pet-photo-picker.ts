import { ImageManipulator, SaveFormat, type ImageManipulatorContext } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { PetError, PetPhotoPermissionError } from '@/features/pets/pet-errors';
import {
  ACCEPTED_INPUT_MIME_TYPES,
  isAcceptedInputMimeType,
  PET_PHOTO_EXTENSION,
  PET_PHOTO_JPEG_QUALITY,
  PET_PHOTO_MAX_DIMENSION,
  PET_PHOTO_MAX_INPUT_BYTES,
  PET_PHOTO_MAX_UPLOAD_BYTES,
  PET_PHOTO_MIME_TYPE,
  type PreparedPetPhoto,
} from '@/features/pets/pet-photo';

export type PetPhotoSource = 'library' | 'camera';

/** Lo mínimo que se necesita de la imagen elegida (nativo: `ImagePickerAsset`; web: `File`). */
type PickedAsset = { uri: string; type?: string | null; mimeType?: string; fileSize?: number };

/**
 * Pide permiso (solo en el momento de la acción), abre galería o cámara y prepara la imagen.
 * Devuelve `null` si el usuario cancela. Errores: `PetPhotoPermissionError` o `PetError`.
 * En web los permisos siempre se conceden y la cámara abre el selector de archivos (`capture`).
 */
export async function pickPetPhoto(source: PetPhotoSource): Promise<PreparedPetPhoto | null> {
  const asset = await launchPicker(source);
  if (!asset) return null;
  validateAsset(asset);
  return preparePhoto(asset.uri);
}

async function launchPicker(source: PetPhotoSource): Promise<PickedAsset | null> {
  // En web no hay permisos ni cámara propia: se usa el selector de archivos del navegador.
  if (Platform.OS === 'web') return pickFileOnWeb();

  // Sin recorte: la foto completa es más útil si luego se reutiliza en un análisis de imagen.
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1, // la compresión se hace después, una sola vez
    exif: false,
  };

  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new PetPhotoPermissionError('camera_permission', permission.canAskAgain);
    }
    try {
      result = await ImagePicker.launchCameraAsync(options);
    } catch (error) {
      // p. ej. emulador o dispositivo sin cámara.
      throw new PetError('camera_unavailable', error);
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new PetPhotoPermissionError('gallery_permission', permission.canAskAgain);
    }
    try {
      result = await ImagePicker.launchImageLibraryAsync(options);
    } catch (error) {
      throw new PetError('image_processing_failed', error);
    }
  }

  if (result.canceled) return null;
  return result.assets[0] ?? null;
}

/**
 * Selector de archivos del navegador. No se usa `launchImageLibraryAsync` en web porque solo
 * resuelve en `change`: al cancelar el diálogo la promesa no termina nunca y la UI queda bloqueada.
 */
function pickFileOnWeb(): Promise<PickedAsset | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_INPUT_MIME_TYPES.join(',');
    input.style.display = 'none';

    const finish = (asset: PickedAsset | null) => {
      input.remove();
      resolve(asset);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      finish(
        file ? { uri: URL.createObjectURL(file), mimeType: file.type, fileSize: file.size } : null,
      );
    });
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}

function validateAsset(asset: PickedAsset): void {
  if (asset.type && asset.type !== 'image') throw new PetError('invalid_image_type');
  // `mimeType` puede faltar en algunos dispositivos; entonces decide la decodificación.
  if (asset.mimeType && !isAcceptedInputMimeType(asset.mimeType)) {
    throw new PetError('invalid_image_type');
  }
  if (asset.fileSize !== undefined && asset.fileSize > PET_PHOTO_MAX_INPUT_BYTES) {
    throw new PetError('image_too_large');
  }
}

/** Redimensiona (lado mayor ≤ PET_PHOTO_MAX_DIMENSION) y recomprime siempre a JPEG. */
async function preparePhoto(uri: string): Promise<PreparedPetPhoto> {
  let base64: string;
  let output: { uri: string; width: number; height: number };
  let context: ImageManipulatorContext | null = null;
  try {
    context = ImageManipulator.manipulate(uri);
    const original = await context.renderAsync();
    const longestSide = Math.max(original.width, original.height);
    let image = original;
    if (longestSide > PET_PHOTO_MAX_DIMENSION) {
      const resize =
        original.width >= original.height
          ? { width: PET_PHOTO_MAX_DIMENSION }
          : { height: PET_PHOTO_MAX_DIMENSION };
      image = await context.resize(resize).renderAsync();
    }
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: PET_PHOTO_JPEG_QUALITY,
      base64: true,
    });
    if (!saved.base64) throw new Error('missing base64 output');
    base64 = saved.base64;
    output = saved;
  } catch (error) {
    // Archivo que no es una imagen decodificable (p. ej. otro tipo renombrado en web).
    throw new PetError('invalid_image_type', error);
  } finally {
    context?.release();
  }

  const bytes = base64ToArrayBuffer(base64);
  if (bytes.byteLength > PET_PHOTO_MAX_UPLOAD_BYTES) throw new PetError('image_too_large');

  return {
    uri: output.uri,
    bytes,
    mimeType: PET_PHOTO_MIME_TYPE,
    extension: PET_PHOTO_EXTENSION,
    width: output.width,
    height: output.height,
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
