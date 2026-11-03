import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { ArrowLeftRight, Trash, UserMinus } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import { TopBar } from '@/components/ui/top-bar';
import {
  deletionErrorFromThrown,
  type AccountDeletionErrorCode,
  type DeletionPlan,
} from '@/features/account/account-deletion';
import {
  useDeleteAccount,
  useDeletionPreview,
  useFinishAccountDeletion,
  useReplaceDeletionPlan,
} from '@/features/account/hooks/use-account-deletion';
import { useAuth } from '@/features/auth/auth-context';
import { useUnsyncedChanges } from '@/features/auth/sign-out-provider';
import { signOutTotal } from '@/features/auth/unsynced-changes';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, tf } from '@/i18n';
import { createSubmitGuard } from '@/lib/submit-guard';
import { spacing } from '@/theme/tokens';

/** Errores que se enseñan dentro del diálogo (se puede volver a confirmar lo mismo). */
const DIALOG_ERRORS: readonly AccountDeletionErrorCode[] = ['network', 'session', 'server'];

/**
 * Eliminar la cuenta (tablero 10.9). Solo con conexión. La Edge Function `delete-account` calcula qué
 * pasará (vista previa) y esta pantalla lo enseña tal cual: cada mascota de la que es titular pasa a su
 * co-tutor editor más antiguo o se borra con todo lo suyo, y deja las que otros comparten con él. Avisa
 * de lo que solo está en este móvil (se perderá) y pide una confirmación explícita (casilla + diálogo).
 * Al confirmar se envía el plan visto; si ya no coincide, la función devuelve el nuevo y se vuelve a
 * confirmar. Tras borrar, se limpia el dispositivo y se cierra la sesión (`useFinishAccountDeletion`):
 * la protección de rutas lleva al acceso, donde se ve la confirmación. Contrato: `docs/README.md` §12.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const toast = useToast();
  const { canUseServer } = useAuth();
  const online = useIsOnline();
  const preview = useDeletionPreview();
  const replacePlan = useReplaceDeletionPlan();
  const remove = useDeleteAccount();
  const finish = useFinishAccountDeletion();
  const { view: changes } = useUnsyncedChanges();
  const [confirmed, setConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<AccountDeletionErrorCode | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [guard] = useState(createSubmitGuard);
  const busy = remove.isPending || finishing;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  /** La cuenta ya no existe en el servidor: limpiar este móvil y salir. Desmonta esta pantalla. */
  const complete = async () => {
    setFinishing(true);
    await finish();
    toast({ message: t('settings.deleteAccount.done') });
  };

  const submit = (plan: DeletionPlan) => {
    void guard.run(async () => {
      setError(null);
      try {
        await remove.mutateAsync(plan);
      } catch (thrown) {
        const failure = deletionErrorFromThrown(thrown);
        setError(failure.code);
        if (DIALOG_ERRORS.includes(failure.code)) return;
        // El plan ya no es el que se vio (o se hizo a medias): se cierra y se revisa de nuevo.
        setDialogOpen(false);
        setConfirmed(false);
        if (failure.code === 'plan_changed' && failure.plan) replacePlan(failure.plan);
        else void preview.refetch();
        return;
      }
      await complete();
    });
  };

  const header = <TopBar onBack={busy ? undefined : back} title={t('settings.deleteAccount.title')} />;
  const frame = (content: ReactNode) => (
    <Screen align="top">
      {header}
      {content}
    </Screen>
  );

  if (finishing) return frame(<LoadingState />);
  if (!canUseServer || !online) {
    return frame(
      <ErrorState offline message={t('settings.deleteAccount.offlineTitle')} description={t('settings.deleteAccount.offlineText')} />
    );
  }
  if (preview.isPending) return frame(<LoadingState />);
  if (preview.isError) {
    const code = deletionErrorFromThrown(preview.error).code;
    return frame(
      <ErrorState
        message={t('settings.deleteAccount.loadError')}
        description={t(`settings.deleteAccount.errors.${code}`)}
        onRetry={() => void preview.refetch()}
      />
    );
  }
  if (preview.data.status === 'already_deleted') {
    return frame(
      <EmptyState
        icon={UserMinus}
        title={t('settings.deleteAccount.alreadyDeletedTitle')}
        description={t('settings.deleteAccount.alreadyDeletedText')}
        actionLabel={t('settings.deleteAccount.alreadyDeletedAction')}
        onAction={() => void complete()}
      />
    );
  }

  const plan = preview.data.plan;
  const ownsPets = plan.transfer.length + plan.delete.length > 0;
  const pending = changes.state === 'ready' ? signOutTotal(changes.summary) : 0;
  const screenError = error && !dialogOpen ? t(`settings.deleteAccount.errors.${error}`) : null;

  return (
    <Screen
      align="top"
      footer={
        <>
          {screenError ? <Alert tone={error === 'plan_changed' ? 'warning' : 'error'} message={screenError} /> : null}
          <Button
            variant="danger"
            label={t('settings.deleteAccount.submit')}
            loading={busy}
            loadingLabel={t('settings.deleteAccount.submitting')}
            disabled={!confirmed}
            onPress={() => {
              setError(null);
              setDialogOpen(true);
            }}
          />
        </>
      }>
      {header}
      <Text color="inkMuted">{t('settings.deleteAccount.intro')}</Text>

      <View style={styles.group}>
        <Text variant="overline" color="inkMuted" accessibilityRole="header">
          {t('settings.deleteAccount.pets')}
        </Text>
        {ownsPets ? (
          <Card flush>
            {plan.transfer.map((item, index) => (
              <ListItem
                key={item.petId}
                plain
                icon={ArrowLeftRight}
                title={item.petName}
                subtitle={
                  item.newOwnerName
                    ? tf('settings.deleteAccount.transferTo', { name: item.newOwnerName })
                    : t('settings.deleteAccount.transferToUnnamed')
                }
                divider={index < plan.transfer.length - 1 || plan.delete.length > 0}
              />
            ))}
            {plan.delete.map((item, index) => (
              <ListItem
                key={item.petId}
                plain
                icon={Trash}
                title={item.petName}
                subtitle={t('settings.deleteAccount.willDelete')}
                divider={index < plan.delete.length - 1}
              />
            ))}
          </Card>
        ) : (
          <Text>{t('settings.deleteAccount.noPets')}</Text>
        )}
        {plan.leaveShared > 0 ? (
          <Text color="inkMuted">
            {plan.leaveShared === 1
              ? t('settings.deleteAccount.sharedOne')
              : tf('settings.deleteAccount.sharedMany', { count: plan.leaveShared })}
          </Text>
        ) : null}
      </View>

      <Text color="inkMuted">{t('settings.deleteAccount.alsoDeleted')}</Text>

      {changes.state === 'error' ? (
        <Alert tone="warning" message={t('settings.deleteAccount.unsyncedUnknown')} />
      ) : pending > 0 ? (
        <Alert tone="warning" message={tf('settings.deleteAccount.unsynced', { count: pending })} />
      ) : null}

      <Text variant="caption" color="inkMuted">
        {t('settings.deleteAccount.export')}
      </Text>

      <Checkbox
        checked={confirmed}
        disabled={busy}
        onChange={(value) => {
          setConfirmed(value);
          setError(null);
        }}
        label={t('settings.deleteAccount.confirm')}
      />

      <Dialog
        visible={dialogOpen}
        tone="danger"
        icon={Trash}
        title={t('settings.deleteAccount.dialogTitle')}
        message={t('settings.deleteAccount.dialogMessage')}
        confirmLabel={t('settings.deleteAccount.submit')}
        loading={busy}
        error={error && dialogOpen ? t(`settings.deleteAccount.errors.${error}`) : null}
        onConfirm={() => submit(plan)}
        onCancel={() => {
          setDialogOpen(false);
          setError(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing['2'],
  },
});
