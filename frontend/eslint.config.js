// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // Metro no descarta código sin usar: la raíz del paquete metería ~1.900 iconos en el bundle.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react-native",
              message: "Importa los iconos desde '@/components/ui/icons' (uno a uno).",
            },
          ],
        },
      ],
    },
  },
]);
