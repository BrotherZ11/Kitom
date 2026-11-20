// Configuración dinámica sobre app.json (Expo la recibe en `config`).
// Push remotos en Android (avisos de invitación, Edge Function `invitation-notify`): el servicio de push de Expo
// entrega por Firebase Cloud Messaging, que necesita el `google-services.json` del proyecto de Firebase en la build.
// - Build local: el archivo en `frontend/google-services.json` (ignorado por git).
// - EAS: variable de tipo archivo `GOOGLE_SERVICES_JSON` (docs/SETUP_GUIDE.md §8).
// Sin él, la app se compila igual y simplemente no recibe push (los avisos por email siguen).
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  if (!googleServicesFile) return config;
  return { ...config, android: { ...config.android, googleServicesFile } };
};
