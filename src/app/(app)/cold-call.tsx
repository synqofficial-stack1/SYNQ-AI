import { Redirect } from 'expo-router';

// Old saved links now open email outreach. Existing call records remain stored.
export default function ColdCallScreen() { return <Redirect href="/sales" />; }
