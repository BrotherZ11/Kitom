import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { Icon } from '@/components/ui/icon';
import { Camera, ImageIcon, Trash } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { Text } from '@/components/ui/text';
import { petErrorMessage, PetPhotoPermissionError } from '@/features/pets/pet-errors';
import type { PreparedPetPhoto } from '@/features/pets/pet-photo';
import { pickPetPhoto, type PetPhotoSource } from '@/features/pets/pet-photo-picker';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { radius, spacing } from '@/theme/tokens';

/**
 * En web el botón de cámara sería un segundo selector de archivos (el navegador decide si ofrece la
 * cámara), así que solo se muestra la galería. En móvil nativo se ofrecen ambas.
 */
const CAN_USE_CAMERA = Platform.OS !== 'web';

type PetPhotoSheetProps = {
  visible: boolean;
  title: string;
  /** Ofrecer «Quitar la foto» (hay una guardada o elegida). */
  canRemove: boolean;
  onClose: () => void;
  /** Foto elegida y preparada (JPEG reducido). Quien abre la hoja decide si se guarda. */
  onPicked: (photo: PreparedPetPhoto) => void;
  onRemove?: () => void;
};

/**
 * Hoja «Foto de …» (tableros 3.2 y 3.3): hacer una foto, elegir de la galería o quitarla. Si el sistema
 * deniega el permiso, lo explica y ofrece abrir los ajustes o seguir sin foto. Cancelar el selector no
 * es un error: la hoja sigue abierta sin mensaje.
 */
export function PetPhotoSheet({ visible, title, canRemove, onClose, onPicked, onRemove }: PetPhotoSheetProps) {
  const theme = useTheme();
  const [picking, setPicking] = useState<PetPhotoSource | null>(null);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (picking) return;
    setError(null);
    onClose();
  };

  const pick = async (source: PetPhotoSource) => {
    setError(null);
    setPicking(source);
    try {
      const photo = await pickPetPhoto(source);
      if (photo) {
        onPicked(photo);
        onClose();
      }
    } catch (pickError) {
      setError(pickError);
    } finally {
      setPicking(null);
    }
  };

  const permission = error instanceof PetPhotoPermissionError ? error : null;

  return (
    <BottomSheet visible={visible} title={title} onClose={close}>
      {permission ? (
        <View style={styles.permission} accessibilityLiveRegion="polite">
          <View style={[styles.tile, { backgroundColor: theme.surfaceSunken }]}>
            <Icon icon={permission.code === 'camera_permission' ? Camera : ImageIcon} size="lg" color="inkMuted" />
          </View>
          <Text variant="title2" style={styles.center} accessibilityRole="header">
            {t(permission.code === 'camera_permission' ? 'pets.photo.cameraPermissionTitle' : 'pets.photo.galleryPermissionTitle')}
          </Text>
          <Text color="inkMuted" style={styles.center}>
            {t('pets.photo.permissionText')}
          </Text>
          <View style={styles.actions}>
            {permission.canAskAgain ? (
              <Button
                label={t('common.retry')}
                onPress={() => void pick(permission.code === 'camera_permission' ? 'camera' : 'library')}
              />
            ) : (
              <Button label={t('pets.photo.openSettings')} onPress={() => void Linking.openSettings()} />
            )}
            <Button variant="ghost" size="md" label={t('pets.photo.continueWithout')} onPress={close} />
          </View>
        </View>
      ) : (
        <>
          <Card flush>
            {CAN_USE_CAMERA ? (
              <ListItem
                icon={Camera}
                title={t('pets.photo.takePhoto')}
                chevron={false}
                onPress={() => void pick('camera')}
                divider
              />
            ) : null}
            <ListItem
              icon={ImageIcon}
              title={t('pets.photo.fromLibrary')}
              chevron={false}
              onPress={() => void pick('library')}
              divider={canRemove && onRemove !== undefined}
            />
            {canRemove && onRemove ? (
              <ListItem
                title={t('pets.photo.remove')}
                titleColor="dangerInk"
                leading={
                  <View style={[styles.removeTile, { backgroundColor: theme.dangerBg }]}>
                    <Icon icon={Trash} size="sm" color="dangerInk" />
                  </View>
                }
                chevron={false}
                onPress={() => {
                  onClose();
                  onRemove();
                }}
              />
            ) : null}
          </Card>
          {picking ? (
            <View style={styles.row} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.primary} />
              <Text variant="caption" color="inkMuted">
                {t('pets.photo.processing')}
              </Text>
            </View>
          ) : null}
          <FormMessage message={error ? petErrorMessage(error) : null} />
          <Text variant="caption" color="inkMuted">
            {t('pets.photo.sheetHint')}
          </Text>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  permission: {
    alignItems: 'center',
    gap: spacing['3'],
  },
  tile: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: spacing['2'],
  },
  removeTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
});
