// La configuración de Expo más lo que Sentry necesita para relacionar cada bundle con su source map.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
