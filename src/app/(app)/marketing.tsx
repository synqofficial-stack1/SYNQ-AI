import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing, WideBreakpoint } from '@/constants/theme';

// One marketing workflow: brainstorm in chat, turn an approved concept into a
// reel, then connect a platform and explicitly confirm before it is published.

export default function MarketingScreen() {
  const { width, height } = useWindowDimensions();
  const wide = width >= WideBreakpoint;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Marketing</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Brainstorm a reel, make it with Synq AI, then choose Instagram, X, or LinkedIn and
          confirm before it goes public.
        </ThemedText>
      </View>

      <ChatPanel
        kind="campaign"
        placeholder="What are we trying to sell, and to whom?"
        emptyHint="Describe your business and who you want to reach, and we can work from there."
        suggestions={[
          'Brainstorm three short reel ideas for my business',
          'Write a 6 second Instagram reel script with a strong hook and a clear CTA',
          'Turn this product idea into a vertical reel concept and caption',
        ]}
        enableVideo
        // Sizes the message list, not the panel: the header, suggestion row and
        // input box add roughly 170px on top, and the page itself does not
        // scroll, so anything taller pushes the input off the bottom of the
        // screen where it cannot be reached.
        height={wide ? Math.max(height - 380, 320) : 360}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    padding: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one },
});
