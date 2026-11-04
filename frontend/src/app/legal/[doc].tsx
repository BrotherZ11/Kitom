import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/query-state';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { getLocale, t } from '@/i18n';
import { isLegalDocumentId, type LegalRun } from '@/i18n/legal/legal-document-types';
import { LEGAL_DOCUMENTS } from '@/i18n/legal/legal-documents.generated';
import { spacing } from '@/theme/tokens';

/**
 * Política de privacidad y términos dentro de la app, con y sin sesión (se enlazan desde el registro). El
 * texto se genera desde las páginas públicas de `site/`, que siguen existiendo porque las tiendas piden una URL.
 */
export default function LegalDocumentScreen() {
  const router = useRouter();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!isLegalDocumentId(doc)) {
    return (
      <Screen align="top">
        <TopBar onBack={close} />
        <EmptyState title={t('settings.legalScreen.notFound')} actionLabel={t('common.back')} onAction={close} />
      </Screen>
    );
  }

  const document = LEGAL_DOCUMENTS[getLocale()][doc];

  return (
    <Screen align="top">
      <TopBar onBack={close} />
      <View style={styles.heading}>
        <Text variant="title1" accessibilityRole="header">
          {document.title}
        </Text>
        <Text variant="caption" color="inkMuted">
          {document.effective}
        </Text>
      </View>
      {document.blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'heading':
            return (
              <Text key={key} variant="title3" accessibilityRole="header" style={styles.section}>
                {block.text}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={key}>
                <Runs runs={block.runs} />
              </Text>
            );
          case 'list':
            return (
              <View key={key} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.listItem}>
                    <Text color="inkMuted">•</Text>
                    <Text style={styles.flex}>
                      <Runs runs={item} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'table':
            // Una tarjeta por fila: tres columnas de texto no caben en un móvil.
            return (
              <View key={key} style={styles.list}>
                {block.rows.map((row, rowIndex) => (
                  <Card key={rowIndex} variant="flat" style={styles.row}>
                    {row.map((cell, cellIndex) => (
                      <View key={cellIndex} style={styles.cell}>
                        <Text variant="overline" color="inkMuted">
                          {block.headers[cellIndex]}
                        </Text>
                        <Text>
                          <Runs runs={cell} />
                        </Text>
                      </View>
                    ))}
                  </Card>
                ))}
              </View>
            );
        }
      })}
    </Screen>
  );
}

function Runs({ runs }: { runs: LegalRun[] }) {
  const router = useRouter();
  return runs.map((run, index) => {
    const { href } = run;
    if (!href) {
      return (
        <Text key={index} variant={run.bold ? 'bodyStrong' : 'body'}>
          {run.text}
        </Text>
      );
    }
    const open = () => {
      if (href.startsWith('doc:')) router.push({ pathname: '/legal/[doc]', params: { doc: href.slice(4) } });
      else void Linking.openURL(href).catch(() => undefined);
    };
    return (
      <Text key={index} variant="bodyStrong" color="primary" accessibilityRole="link" onPress={open} style={styles.link}>
        {run.text}
      </Text>
    );
  });
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing['1'],
  },
  section: {
    marginTop: spacing['3'],
  },
  list: {
    gap: spacing['3'],
  },
  listItem: {
    flexDirection: 'row',
    gap: spacing['2'],
  },
  flex: {
    flex: 1,
  },
  row: {
    padding: spacing['4'],
    gap: spacing['3'],
  },
  cell: {
    gap: spacing['1'],
  },
  link: {
    textDecorationLine: 'underline',
  },
});
