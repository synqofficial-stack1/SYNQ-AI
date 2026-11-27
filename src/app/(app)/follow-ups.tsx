import { Redirect } from 'expo-router';

export default function FollowUpsScreen() {
  // `view=actions` is not a Sales section, so the old link opened Overview
  // with a query the screen ignores. Land on Sales itself.
  return <Redirect href="/sales" />;
}
