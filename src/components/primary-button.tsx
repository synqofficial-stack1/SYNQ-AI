import { Button, type ButtonVariant } from '@/components/ui/button';

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Defaults to the yellow primary. Pass `secondary` for a supporting action. */
  variant?: ButtonVariant;
  /** Older screens expect a full-width button; new code can opt out. */
  fullWidth?: boolean;
};

/** The original full-width call to action, now drawn by the shared Button. */
export function PrimaryButton({ title, onPress, loading, disabled, variant = 'primary', fullWidth = true }: Props) {
  return (
    <Button
      label={title}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      variant={variant}
      size="lg"
      fullWidth={fullWidth}
    />
  );
}
