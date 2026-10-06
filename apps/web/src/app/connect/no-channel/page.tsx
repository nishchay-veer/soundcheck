import { ConnectButton } from "@/components/auth-buttons";
import { Notice } from "@/components/notice";

export default function NoChannelPage() {
  return (
    <Notice
      title="This Google account has no YouTube channel"
      action={<ConnectButton label="Use another account" />}
    >
      <p>
        Sign in with the Google account that owns your channel. If your channel is a brand account,
        sign in with the account Google shows as its owner.
      </p>
    </Notice>
  );
}
