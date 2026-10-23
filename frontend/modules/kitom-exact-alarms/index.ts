import { requireOptionalNativeModule } from 'expo';

/**
 * Módulo nativo local (solo Android, `android/…/KitomExactAlarmsModule.kt`). En iOS, en web y en Expo Go
 * no existe: `null`.
 */
type KitomExactAlarmsModule = {
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): boolean;
};

export default requireOptionalNativeModule<KitomExactAlarmsModule>('KitomExactAlarms');
