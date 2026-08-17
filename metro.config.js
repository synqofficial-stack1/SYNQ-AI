const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js's realtime-js sub-dependency ships a package.json "exports" map
// that Metro's package-exports resolution misreads on web, causing
// "Unable to resolve module ./RealtimeClient". Disabling it here is the documented
// workaround (Supabase + Expo/Metro is a known incompatibility as of SDK 57).
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
