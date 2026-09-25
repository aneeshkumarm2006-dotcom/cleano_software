import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Keyboard, Platform } from "react-native";

/**
 * True while this screen is the one on top AND the app is in the foreground.
 * Conversations poll only then: v1 has no websockets, and a phone in a pocket
 * shouldn't keep asking for messages nobody is looking at.
 */
export function useLive(): boolean {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return focused && active;
}

/** Whether the software keyboard is up, so the composer can drop its safe-area padding. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // iOS announces the keyboard before it moves, Android only after.
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
