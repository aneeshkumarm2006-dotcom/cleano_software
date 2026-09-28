import { ApiError } from "@bookmops/api/client";
import { Button, color, Icon, radius, space, Text, TextField } from "@bookmops/ui-native";
import { useRef, useState } from "react";
import { type TextInput, View } from "react-native";

import { useSource } from "@/data/session";

const MIN = 8;

/**
 * Choose a new password: the current one, then the new one twice. The server
 * clears a pending "must change" and signs out every other device.
 */
export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const source = useSource();
  const newRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length >= MIN && confirm === next;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await source.changePassword(current, next);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space[4] }}>
      <TextField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secret
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        onSubmitEditing={() => newRef.current?.focus()}
      />
      <TextField
        ref={newRef}
        label="New password"
        value={next}
        onChangeText={setNext}
        secret
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`At least ${MIN} characters`}
        error={tooShort ? `Use at least ${MIN} characters.` : null}
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
      />
      <TextField
        ref={confirmRef}
        label="New password again"
        value={confirm}
        onChangeText={setConfirm}
        secret
        autoComplete="new-password"
        textContentType="newPassword"
        error={mismatch ? "These don't match." : null}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? (
        <View accessibilityLiveRegion="assertive" style={{ flexDirection: "row", gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.dangerSoft }}>
          <Icon name="warning" size={18} color="danger" />
          <Text variant="small" color="danger" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
      <Button label="Save new password" onPress={submit} loading={busy} disabled={!ready} />
    </View>
  );
}
