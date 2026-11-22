// Declara como opcionales las funciones de hardware que Android deduce de la configuración, para que Google Play
// no deje la app fuera de tabletas, Chromebooks o Android XR:
// - android.hardware.wifi: la deduce de ACCESS_WIFI_STATE (lo añade expo-network). La app funciona con datos móviles.
// - android.hardware.screen.portrait: la deduce de `orientation: "portrait"`. En pantallas solo horizontales Android
//   muestra la app en vertical con bandas laterales.
// Sin `/android` en git, el manifiesto se genera en cada prebuild: este plugin lo corrige ahí.
const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_FEATURES = ['android.hardware.wifi', 'android.hardware.screen.portrait'];

module.exports = function withOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const features = manifest['uses-feature'] ?? [];
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((feature) => feature.$?.['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;
    return mod;
  });
};
