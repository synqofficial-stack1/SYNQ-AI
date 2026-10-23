import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DepartmentActivityChart } from '@/components/department-activity-chart';
import { SparkIcon, VideoIcon } from '@/components/icons';
import { MarketingPublisher } from '@/components/marketing-publisher';
import { Button, PageHeader } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function MarketingScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const publisherY = useRef<number | null>(null);
  const jumped = useRef(false);

  const toPublisher = () => {
    if (publisherY.current !== null) scrollRef.current?.scrollTo({ y: Math.max(0, publisherY.current - 16), animated: true });
  };

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
      <PageHeader
        title="Marketing"
        description="Brainstorm campaigns, create reels and publish them to your connected channels."
        actions={
          <>
            <Button label="Create reel" icon={VideoIcon} onPress={toPublisher} />
            <Button
              label="Ask Marketing AI"
              variant="primary"
              icon={SparkIcon}
              onPress={() => router.push('/marketing?ai=1&department=marketing' as Parameters<typeof router.push>[0])}
            />
          </>
        }
      />

      <DepartmentActivityChart department="marketing" />

      {/* `/marketing?view=create` (the dashboard's "Create reel") lands on the publisher. */}
      <View
        onLayout={(event) => {
          publisherY.current = event.nativeEvent.layout.y;
          if (view === 'create' && !jumped.current) {
            jumped.current = true;
            setTimeout(toPublisher, 0);
          }
        }}
      >
        <MarketingPublisher />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, padding: 28, width: '100%', maxWidth: MaxContentWidth + 160, alignSelf: 'center' },
});
