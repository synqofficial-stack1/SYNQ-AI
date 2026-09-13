import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing, WideBreakpoint } from '@/constants/theme';

// Marketing is one chat and nothing else.
//
// It used to be three pages with campaign rows, content rows, statuses and a
// tab strip, none of which could actually post, send or launch anything — so
// every status on them was a status about a draft. A chat is the honest shape
// for that: it helps you think, and says so.
//
// `kind` decides which system prompt the server loads. Both 'campaign' and
// 'content' resolve to the marketing department; this uses one of them rather
// than introducing a kind the conversations table would reject.

export default function MarketingScreen() {
  const { width, height } = useWindowDimensions();
  const wide = width >= WideBreakpoint;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Marketing</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Think out loud about campaigns, positioning and copy. It drafts and argues back. It
          does not post anything.
        </ThemedText>
      </View>

      <ChatPanel
        kind="campaign"
        placeholder="What are we trying to sell, and to whom?"
        emptyHint="Describe your business and who you want to reach, and we can work from there."
        suggestions={[
          'Help me position a website service for local salons',
          'Write three Instagram captions for a launch',
          'What should I post in my first week?',
        ]}
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
