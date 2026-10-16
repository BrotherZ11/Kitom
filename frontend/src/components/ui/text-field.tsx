import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { CircleAlert, Eye, EyeOff } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { borderWidth, fontFamily, radius, size, spacing } from '@/theme/tokens';

type TextFieldProps = TextInputProps & {
  /** Siempre visible encima (nunca solo placeholder). */
  label: string;
  /** Ayuda bajo el campo. */
  hint?: string;
  /** Error de validación: sustituye a la ayuda, marca el campo y se anuncia. */
  error?: string | null;
  /** Añade «· opcional» a la etiqueta (en vez de marcar los obligatorios). */
  optional?: boolean;
  /** Unidad al final del campo, en mono (kg, años). */
  unit?: string;
};

/**
 * Campo de texto de marca (docs/design/componentes/TextField): 52 de alto, borde de control; foco y
 * error con borde de 2 px; bloqueado (`editable={false}`) sobre fondo hundido. Con `secureTextEntry`
 * ofrece mostrar u ocultar la contraseña.
 */
export function TextField({
  label,
  hint,
  error,
  optional = false,
  unit,
  style,
  multiline,
  editable = true,
  secureTextEntry,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const helper = error ?? hint;
  const fullLabel = optional ? `${label} · ${t('ui.optional')}` : label;

  const border = !editable
    ? { width: 0, color: 'transparent' }
    : error
      ? { width: borderWidth.focus, color: theme.dangerInk }
      : isFocused
        ? { width: borderWidth.focus, color: theme.primary }
        : { width: borderWidth.control, color: theme.lineControl };

  return (
    <View style={styles.container}>
      <Text variant="label" maxFontSizeMultiplier={1.6}>
        {label}
        {optional ? (
          <Text variant="label" color="inkMuted">{` · ${t('ui.optional')}`}</Text>
        ) : null}
      </Text>
      <View
        style={[
          styles.box,
          multiline && styles.multilineBox,
          {
            backgroundColor: editable ? theme.surface : theme.surfaceSunken,
            borderWidth: border.width,
            borderColor: border.color,
            // El texto no se mueve al cambiar el grosor del borde.
            paddingLeft: spacing['4'] - border.width,
            paddingRight: (secureTextEntry ? spacing['1'] : spacing['4']) - border.width,
          },
        ]}>
        <TextInput
          accessibilityLabel={fullLabel}
          accessibilityHint={helper ?? undefined}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={theme.inkSubtle}
          maxFontSizeMultiplier={1.6}
          multiline={multiline}
          editable={editable}
          secureTextEntry={secureTextEntry && !isRevealed}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            { color: editable ? theme.ink : theme.inkSubtle },
            style,
          ]}
          {...inputProps}
        />
        {unit ? (
          <Text variant="data" color="inkMuted">
            {unit}
          </Text>
        ) : null}
        {secureTextEntry ? (
          <IconButton
            icon={isRevealed ? EyeOff : Eye}
            accessibilityLabel={t(isRevealed ? 'ui.hidePassword' : 'ui.showPassword')}
            color="inkMuted"
            onPress={() => setIsRevealed((current) => !current)}
          />
        ) : null}
      </View>
      {error ? (
        <FieldError message={error} />
      ) : hint ? (
        <Text variant="caption" color="inkMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Error de un campo: icono + texto en `dangerInk` (nunca solo color), anunciado al aparecer. */
export function FieldError({ message }: { message: string }) {
  return (
    <View style={styles.helperRow} accessibilityLiveRegion="polite">
      <Icon icon={CircleAlert} size={14} color="dangerInk" />
      <Text variant="caption" color="dangerInk" style={styles.errorText}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  box: {
    minHeight: size.input,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2'],
  },
  multilineBox: {
    minHeight: 104,
    alignItems: 'flex-start',
    paddingVertical: spacing['3'],
  },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    // 16 px: evita el zoom automático de iOS al enfocar.
    fontFamily: fontFamily.sans400,
    fontSize: 16,
    paddingVertical: spacing['3'],
  },
  multilineInput: {
    paddingVertical: 0,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  errorText: {
    flex: 1,
    fontFamily: fontFamily.sans500,
  },
});
