package expo.modules.kitomexactalarms

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Alarmas exactas (Android 12+): expo-notifications programa los avisos con
 * `setExactAndAllowWhileIdle` solo si `canScheduleExactAlarms()`; si no, Android puede retrasarlos.
 * Este módulo solo consulta ese permiso y abre su pantalla de ajustes («Alarmas y recordatorios»).
 */
class KitomExactAlarmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KitomExactAlarms")

    Function("canScheduleExactAlarms") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function true
      val alarmManager = appContext.reactContext?.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        ?: return@Function false
      alarmManager.canScheduleExactAlarms()
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }
  }
}
