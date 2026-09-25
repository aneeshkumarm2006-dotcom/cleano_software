import { Text } from "@bookmops/ui-native";

import { goBackOr } from "@/components/BackButton";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";
import { BackHeader, Page } from "@/features/record/ui";

/** Change password, from More. */
export default function ChangePassword() {
  return (
    <Page header={<BackHeader title="Change password" />}>
      <Text variant="body" color="ink2">
        Every other phone or browser signed in as you will be signed out.
      </Text>
      <ChangePasswordForm onDone={() => goBackOr("/more")} />
    </Page>
  );
}
