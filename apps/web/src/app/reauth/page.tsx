import { ConnectButton } from "@/components/auth-buttons";
import { Notice } from "@/components/notice";

export default function ReauthPage() {
  return (
    <Notice title="Reconnect your channel" action={<ConnectButton label="Reconnect YouTube" />}>
      <p>
        Google has expired Soundcheck&apos;s access to your channel, so we can&apos;t read new
        analytics until you reconnect. Your existing results are kept.
      </p>
      <p>Reconnecting takes one click and asks for the same read-only permissions.</p>
    </Notice>
  );
}
