import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getAIUsage, type AIUsage } from '@/lib/ai-usage';

export function AIUsageNotice({ sending = false, showUpgrade = true }: { sending?: boolean; showUpgrade?: boolean }) {
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (sending) return;
    let live = true;
    const refresh = () => getAIUsage().then(value => { if (live) { setUsage(value); setError(''); } })
      .catch(() => { if (live) setError('Credit balance unavailable.'); });
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [sending]);
  return (
    <View style={{ gap: Spacing.one, padding: Spacing.two }}>
      <ThemedText type="caption" themeColor="textSecondary">
        {error || (usage ? `${usage.remaining} / ${usage.limit} credits left` : 'Loading credits…')} · Chat: 1 · Image: 2
      </ThemedText>
      {usage && <ThemedText type="caption" themeColor="textSecondary">
        {usage.resets_at ? `Resets ${new Date(usage.resets_at).toLocaleString()}` : 'Resets 24 hours after your first request.'}
      </ThemedText>}
      {showUpgrade && <Pressable accessibilityRole="link" onPress={() => router.push('/upgrade')}>
        <ThemedText type="caption" themeColor="accentText">Upgrade for more credits and added benefits</ThemedText>
      </Pressable>}
    </View>
  );
}
