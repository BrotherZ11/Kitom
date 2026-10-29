# Kitom — app (Expo)

App Expo de Kitom (SDK 57, React Native 0.86, TypeScript, Expo Router). Visión general del proyecto,
estado y documentación: [README de la raíz](../README.md). Reglas de código, estructura y cómo probar
contra el Supabase local: [CLAUDE.md](CLAUDE.md).

## Arrancar

```bash
npm install
cp .env.example .env   # EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY (públicas)
npx expo start         # contra el proyecto de .env
npm run start:local    # contra el Supabase local (npx supabase start en la raíz)
```

Los avisos locales y las alarmas exactas (`modules/kitom-exact-alarms`) necesitan una build nativa;
en Expo Go no funcionan.

## Comprobar

```bash
npx tsc --noEmit
npx expo lint
npm test
npm run test:integration   # solo contra el Supabase local
```

Dependencias siempre con `npx expo install <paquete>`. Compilación y publicación:
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
