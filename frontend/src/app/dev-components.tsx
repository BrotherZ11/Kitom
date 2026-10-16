import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Check, ChevronRight, Info, WifiOff, X } from '@/components/ui/icons';
import { ListItem } from '@/components/ui/list-item';
import { OptionGroup } from '@/components/ui/option-group';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StepSelector } from '@/components/ui/step-selector';
import { Switch } from '@/components/ui/switch';
import { Tag } from '@/components/ui/tag';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { useStackScreenOptions } from '@/theme/theme-provider';
import { spacing } from '@/theme/tokens';

/*
 * Galería de componentes (tablero «0.1 Componentes y estados») para revisar el sistema de diseño en
 * dispositivo. SOLO DESARROLLO: la ruta está protegida con `__DEV__` en el layout raíz y no existe en
 * producción. Por eso es la única pantalla con textos fuera de `src/i18n/` (contenido de muestra del
 * prototipo, nunca visible para usuarios).
 */

const SCALE = ['Mucho menos', 'Menos', 'Como siempre', 'Más', 'Mucho más'];

export default function DevComponentsScreen() {
  const toast = useToast();
  const stackOptions = useStackScreenOptions();
  const [segment, setSegment] = useState<'f' | 'm' | 'u' | null>('f');
  const [tags, setTags] = useState<string[]>(['vet']);
  const [option, setOption] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(3);
  const [switchOn, setSwitchOn] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);

  const toggleTag = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));

  return (
    <Screen align="top" edges={['bottom', 'left', 'right']} gap={spacing['6']}>
      <Stack.Screen options={{ ...stackOptions, title: 'Componentes (dev)' }} />

      <Section title="Botones">
        <Button label="Guardar el día" />
        <Button label="Guardar el día" loading loadingLabel="Guardando…" />
        <Button label="Guardar el día" disabled />
        <Button label="Añadir detalles" variant="secondary" />
        <Button label="Ver tendencias" variant="ghost" />
        <Button label="Eliminar" variant="danger" />
        <Button label="Eliminar mascota" variant="dangerGhost" />
        <Button label="Continuar" size="md" variant="secondary" icon={Info} />
        <View style={styles.row}>
          <Button label="Reintentar" size="sm" />
          <Button label="Consultar" size="sm" variant="secondary" icon={Check} />
          <Button label="Deshacer" size="sm" variant="ghost" />
        </View>
        <View style={styles.row}>
          <IconButton icon={X} accessibilityLabel="Cerrar" />
          <IconButton icon={ChevronRight} accessibilityLabel="Abrir" variant="soft" />
          <IconButton icon={X} accessibilityLabel="Cerrar" disabled />
        </View>
      </Section>

      <Section title="Campos">
        <TextField label="Email" placeholder="kika@ejemplo.com" hint="Te enviaremos un enlace." />
        <TextField label="Contraseña" value="kika1234" secureTextEntry error="Mínimo 8 caracteres." />
        <TextField label="Peso" optional unit="kg" keyboardType="decimal-pad" placeholder="12,4" />
        <TextField label="Especie" value="Perro" editable={false} hint="La especie no se puede cambiar." />
        <TextField label="Nota" optional multiline placeholder="Algo que quieras recordar" />
      </Section>

      <Section title="Selección">
        <SegmentedControl
          label="Sexo"
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'f', label: 'Hembra' },
            { value: 'm', label: 'Macho' },
            { value: 'u', label: 'No lo sé' },
          ]}
        />
        <View style={styles.wrap}>
          <Chip label="Todo como siempre" icon={Check} />
          <Chip label="Visita al veterinario" selected={tags.includes('vet')} onPress={() => toggleTag('vet')} />
          <Chip label="Cambio de casa" selected={tags.includes('home')} onPress={() => toggleTag('home')} />
          <Chip label="Máx. 3 series" selected={false} disabled />
        </View>
        <OptionGroup
          label="Raza"
          value={option}
          onChange={setOption}
          error={option ? null : 'Elige una opción.'}
          options={[
            { value: 'known', label: 'Sé su raza' },
            { value: 'mixed', label: 'Mestiza' },
            { value: 'unknown', label: 'No lo sé' },
          ]}
        />
        <StepSelector
          label="Energía"
          valueLabel={step === null ? 'Sin indicar' : SCALE[step - 1]}
          value={step}
          onChange={setStep}
          lowLabel="Mucho menos"
          highLabel="Mucho más"
          selectedHint="Toca otra vez para dejarlo sin indicar."
          steps={SCALE.map((word, index) => ({ value: index + 1, accessibilityLabel: `Energía: ${word}` }))}
        />
        <View style={styles.row}>
          <Switch value={switchOn} onValueChange={setSwitchOn} accessibilityLabel="Algo fuera de lo habitual" />
          <Text>Algo fuera de lo habitual</Text>
          <Switch value={false} onValueChange={() => {}} accessibilityLabel="Desactivado" disabled />
        </View>
      </Section>

      <Section title="Tarjetas y listas">
        <Card>
          <Text variant="title3">Falta el registro de hoy</Text>
          <Text color="inkMuted">Unos 40 segundos. Kika lleva 5 días esta semana.</Text>
        </Card>
        <Card variant="brand">
          <Text variant="bodyStrong">Completa el perfil de Kika</Text>
        </Card>
        <Card variant="warm">
          <Text color="warmInk">Hoy he dormido mucho. ¿Paseo largo?</Text>
        </Card>
        <Card flush>
          <ListItem title="Consultar con una foto" subtitle="Posibles causas y señales de alerta" icon={Info} onPress={() => {}} divider />
          <ListItem title="Sueño" value="Normal" divider />
          <ListItem title="Kika" subtitle="Perra · mestiza" leading={<Avatar name="Kika" size="md" />} onPress={() => {}} />
        </Card>
        <View style={styles.row}>
          <Avatar name="Kika" size="sm" />
          <Avatar name="Kika" size="md" tone="warm" />
          <Avatar name="Atom" size="lg" />
          <Avatar name="Atom" size="xl" tone="warm" />
        </View>
      </Section>

      <Section title="Alertas y estados">
        <Alert tone="info" message="Esta orientación es informativa y no sustituye a un veterinario." />
        <Alert tone="success" title="Registro sincronizado" message="Los cambios ya están en tu cuenta." />
        <Alert tone="warning" icon={WifiOff} title="Sin conexión" message="Guardamos el registro en el móvil." />
        <Alert
          tone="error"
          title="No hemos podido guardar"
          message="Tus respuestas siguen aquí."
          action={{ label: 'Reintentar', onPress: () => {} }}
        />
        <Banner message="1 registro pendiente de enviar" busy />
        <Banner tone="warning" icon={WifiOff} message="Sin conexión. Puedes seguir registrando." />
        <View style={styles.wrap}>
          <Tag label="Guardado" tone="success" icon={Check} />
          <Tag label="Pendiente de enviar" />
          <Tag label="Hoy" tone="accent" />
          <Tag label="Premium" tone="brand" />
        </View>
        <LoadingState />
        <EmptyState title="Nada en la agenda" description="Añade la próxima vacuna o una medicación." actionLabel="Añadir" onAction={() => {}} />
        <ErrorState message="No hemos podido cargar el historial." onRetry={() => {}} />
      </Section>

      <Section title="Superposiciones">
        <Button label="Abrir diálogo" variant="secondary" onPress={() => setDialog(true)} />
        <Button label="Abrir hoja" variant="secondary" onPress={() => setSheet(true)} />
        <Button
          label="Mostrar aviso"
          variant="secondary"
          onPress={() => toast({ message: 'Cambios guardados', action: { label: 'Deshacer', onPress: () => {} } })}
        />
      </Section>

      <Dialog
        visible={dialog}
        tone="danger"
        title="¿Eliminar el perfil de Kika?"
        message="Se borrarán sus registros, fotos y recordatorios. No se puede deshacer."
        confirmLabel="Eliminar perfil"
        onConfirm={() => setDialog(false)}
        onCancel={() => setDialog(false)}
      />
      <BottomSheet
        visible={sheet}
        title="Foto de Kika"
        onClose={() => setSheet(false)}
        footer={<Button label="Hacer una foto" onPress={() => setSheet(false)} />}>
        <ListItem title="Elegir de la galería" icon={Info} onPress={() => setSheet(false)} divider />
        <ListItem title="Quitar la foto" onPress={() => setSheet(false)} />
      </BottomSheet>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" color="inkMuted">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing['3'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing['3'],
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing['2'],
  },
});
