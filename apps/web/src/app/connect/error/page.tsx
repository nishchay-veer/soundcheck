import { ConnectButton } from "@/components/auth-buttons";
import { Notice } from "@/components/notice";

export default function ConnectErrorPage() {
  return (
    <Notice
      title="Something went wrong connecting your channel"
      action={<ConnectButton label="Try again" />}
    >
      <p>Nothing was saved. Please try again in a minute.</p>
    </Notice>
  );
}
