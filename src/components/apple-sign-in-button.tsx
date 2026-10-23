import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, View } from 'react-native';

export function AppleSignInButton({
  onPress,
  disabled = false,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  if (Platform.OS !== 'ios') return null;

  return (
    <View pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={29}
        style={{ width: '100%', height: 58 }}
        onPress={onPress}
      />
    </View>
  );
}
