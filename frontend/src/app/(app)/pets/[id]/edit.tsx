import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Trash } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { useToast } from '@/components/ui/toast';
import { TopBar, TopBarText } from '@/components/ui/top-bar';
import { useAuth } from '@/features/auth/auth-context';
import { usePendingDailyLogCount } from '@/features/pets/components/pet-deletion-status';
import { PetForm } from '@/features/pets/components/pet-form';
import { PetPhotoEditor } from '@/features/pets/components/pet-photo-editor';
import { useDeletePet, useSavePetEdit, type DeletePetOutcome } from '@/features/pets/hooks/use-pet-writes';
import { useCanEditPet, usePet } from '@/features/pets/hooks/use-pets';
import { useSpecies } from '@/features/pets/hooks/use-species';
import { resolveEditPetForm } from '@/features/pets/offline/pet-form-gate';
import { isLocalPetId, type DeleteRejection } from '@/features/pets/offline/pet-operation';
import { PetEditRejectedError } from '@/features/pets/offline/pet-sync-engine';
import { isPetOfflineError, petErrorMessage } from '@/features/pets/pet-errors';
import { toPetFormValues } from '@/features/pets/pet-form';
import { missingProfileFields, PROFILE_FIELDS } from '@/features/pets/pet-profile';
import type { PetFields } from '@/features/pets/types';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf, type TranslationKey } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';

/**
 * Editar el perfil (tablero 3.8): todo opcional salvo el nombre; la especie no cambia si solo hay una
 * disponible. La foto se gestiona aparte (hoja 3.2). Eliminar (solo el propietario) se confirma con
 * sus consecuencias (3.11). Al guardar, vuelve con «Cambios guardados» (3.7).
 *
 * Guardar es siempre en el dispositivo primero (fase 8) y lo envía la sincronización con la
 * precondición de la versión editada (`serverPet`); con conexión espera brevemente al servidor. Sin
 * conexión se edita la copia del dispositivo (o el borrador de un alta local) y se avisa. La foto sigue
 * necesitando conexión. Con un conflicto o sin permiso, primero se decide qué hacer.
 *
 * Eliminar (fase 10) también se guarda primero en el dispositivo, con la versión que se ve como
 * precondición, y se puede deshacer hasta que el servidor la aplique. Un borrador que nunca salió se
 * descarta sin más. Con una eliminación guardada no se edita: se vuelve a la ficha, que la enseña.
 */
const REJECTION_MESSAGE: Record<DeleteRejection, TranslationKey> = {
  not_owner: 'pets.deletion.notOwner',
  no_base: 'pets.deletion.noBase',
  synced_create: 'pets.deletion.noBase',
  not_deletable: 'pets.deletion.notDeletable',
};

export default function EditPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user, canUseServer } = useAuth();
  const online = useIsOnline();
  const writable = canUseServer && online;
  const isLocal = isLocalPetId(id);
  const pet = usePet(id);
  const { view } = pet;
  const canEdit = useCanEditPet(id);
  const species = useSpecies();
  const save = useSavePetEdit(id);
  const deletePet = useDeletePet(id);
  const [guard] = useState(createSubmitGuard);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pendingLogs = usePendingDailyLogCount(isLocal ? null : id);
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/pets/[id]', params: { id } }));

  const handleSubmit = (fields: PetFields) => {
    void guard.run(async () => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const outcome = await save(fields, isLocal ? null : pet.serverPet, { waitForServer: writable });
        const op = outcome.op;
        if (op?.status === 'failed' && op.lastError?.kind === 'validation') {
          // Sigue guardado en el dispositivo; se corrige aquí mismo y se vuelve a guardar.
          setSubmitError(t('pets.sync.detail.failed'));
          return;
        }
        setSaved(true);
        if (op?.status === 'conflict') {
          router.replace({ pathname: '/pets/[id]/resolve', params: { id } });
          return;
        }
        toast({ message: outcome.synced ? t('pets.edit.saved') : t('pets.sync.savedLocally') });
        back();
      } catch (error) {
        setSubmitError(error instanceof PetEditRejectedError ? t('pets.sync.editBlocked') : t('pets.errors.unknown'));
      } finally {
        setSubmitting(false);
      }
    });
  };

  const frame = (content: ReactNode) => (
    <Screen align="top">
      <TopBar onBack={back} title={pet.data ? tf('pets.edit.heading', { name: pet.data.name }) : t('pets.edit.title')} />
      {content}
    </Screen>
  );

  // Un alta ya confirmada se edita con su id del servidor.
  if (pet.redirectTo) return <Redirect href={{ pathname: '/pets/[id]/edit', params: { id: pet.redirectTo } }} />;
  // Con una eliminación guardada no se edita: la ficha enseña su estado (y deshacerla).
  if (pet.deletion && !confirmingDelete) return <Redirect href={{ pathname: '/pets/[id]', params: { id } }} />;

  const gate = resolveEditPetForm({ pet: view, op: pet.op, species, writable, isOfflineError: isPetOfflineError });

  if (gate.state === 'loading') return frame(<LoadingState />);
  if (gate.state === 'offline') {
    return frame(
      <ErrorState
        offline
        message={t('pets.offline.editTitle')}
        description={species.isError ? t('pets.sync.speciesUnavailable') : t('pets.offline.detailUnavailableText')}
        onRetry={() => {
          pet.refetch();
          void species.refetch();
        }}
      />
    );
  }
  if (gate.state === 'blocked') {
    return frame(
      <Alert
        tone="warning"
        message={t('pets.sync.editBlocked')}
        action={
          pet.op?.status === 'conflict'
            ? { label: t('pets.sync.resolve'), onPress: () => router.replace({ pathname: '/pets/[id]/resolve', params: { id } }) }
            : { label: t('common.back'), onPress: back }
        }
      />
    );
  }
  if (gate.state === 'error') {
    const retry = gate.source === 'pet' ? pet.refetch : () => void species.refetch();
    return frame(<ErrorState message={petErrorMessage(gate.error)} onRetry={retry} />);
  }
  if (gate.state === 'not_found' || view.state !== 'ready' || !species.data) {
    return frame(
      <EmptyState
        title={t('pets.detail.notFound')}
        actionLabel={t('pets.detail.backToList')}
        onAction={() => router.dismissTo('/pets')}
      />
    );
  }

  const current = view.pet;
  const filled = PROFILE_FIELDS.length - missingProfileFields(current).length;
  // Solo UX: ocultar lo que RLS rechazaría (borrar: propietario; lo decide el servidor al sincronizar).
  const isOwner = current.owner_id === user?.id;
  // Un alta que el propietario ya no ve no se borra: se descarta lo guardado (aviso de la ficha).
  const canDelete = isOwner && !(isLocal && pet.op?.status === 'forbidden');

  // Qué pasará al confirmar: borrador sin enviar, alta sin confirmar, sin conexión o con conexión.
  const deleteMessage = [
    isLocal
      ? pet.op?.inFlightSince === null
        ? t('pets.deletion.dialogDraft')
        : t('pets.deletion.dialogDraftUncertain')
      : t('pets.detail.deleteConfirmDescription'),
    !isLocal && !writable ? t('pets.deletion.dialogOffline') : null,
    pendingLogs ? (pendingLogs === 1 ? t('pets.deletion.pendingLogsOne') : tf('pets.deletion.pendingLogs', { count: pendingLogs })) : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const afterDelete = (outcome: DeletePetOutcome) => {
    if (outcome.status === 'rejected') {
      setDeleteError(t(REJECTION_MESSAGE[outcome.reason]));
      return;
    }
    if (outcome.status === 'undone') {
      setConfirmingDelete(false);
      toast({ message: t('pets.deletion.undoneWhileWaiting') });
      return;
    }
    if (outcome.status === 'pending' && (outcome.op.status !== 'pending' || outcome.op.inFlightSince !== null)) {
      // Conflicto, sin permiso, fallo o sin confirmar: la ficha dice qué pasa y qué se puede hacer.
      router.replace({ pathname: '/pets/[id]', params: { id } });
      return;
    }
    const message =
      outcome.status === 'cancelled'
        ? t('pets.deletion.draftDiscarded')
        : outcome.status === 'deleted'
          ? t('pets.deletion.deleted')
          : t('pets.deletion.savedLocally');
    toast({ message });
    router.dismissTo('/');
  };

  return (
    <>
      <PetForm
        variant="edit"
        // Los valores iniciales se leen una vez: el formulario no se resetea si la caché se refresca.
        // Con cambios pendientes, son los del dispositivo (se consolidan con esta edición).
        initialValues={toPetFormValues(current)}
        species={species.data}
        header={
          <TopBar
            onBack={back}
            title={tf('pets.edit.heading', { name: current.name })}
            right={<TopBarText mono text={`${filled}/${PROFILE_FIELDS.length}`} />}
          />
        }
        photo={isLocal ? null : <PetPhotoEditor pet={current} canEdit={canEdit.data === true && writable} />}
        footerExtra={
          canDelete ? (
            <Button
              variant="dangerGhost"
              size="md"
              icon={Trash}
              label={tf('pets.edit.delete', { name: current.name })}
              onPress={() => {
                deletePet.reset();
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
            />
          ) : undefined
        }
        isSubmitting={submitting}
        leaveAllowed={confirmingDelete || saved}
        submitError={submitError}
        offline={gate.offline}
        onSubmit={handleSubmit}
      />
      <Dialog
        visible={confirmingDelete}
        tone="danger"
        icon={Trash}
        title={tf('pets.detail.deleteTitleNamed', { name: current.name })}
        message={deleteMessage}
        confirmLabel={tf('pets.detail.deleteNamed', { name: current.name })}
        loading={deletePet.isPending}
        error={deleteError ?? (deletePet.isError ? petErrorMessage(deletePet.error) : null)}
        // La versión que se ve (servidor o copia) es la precondición; un alta local no tiene.
        onConfirm={() => deletePet.mutate(isLocal ? null : pet.serverPet, { onSuccess: afterDelete })}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
