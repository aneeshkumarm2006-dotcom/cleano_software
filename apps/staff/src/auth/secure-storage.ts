// The phone's secure storage (Keychain on iOS, Keystore on Android), set so
// that nothing stored here syncs to iCloud or another device, and nothing can
// be read while the phone is locked.
import * as SecureStore from "expo-secure-store";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Synchronous, as the auth client's storage interface requires. */
export const secureStorage = {
  getItem: (key: string): string | null => SecureStore.getItem(key, OPTIONS),
  setItem: (key: string, value: string): void => SecureStore.setItem(key, value, OPTIONS),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key, OPTIONS),
};
