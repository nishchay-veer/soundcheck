import { ConnectButton } from "@/components/auth-buttons";
import { Notice } from "@/components/notice";

export default function MissingScopesPage() {
  return (
    <Notice
      title="Soundcheck needs both YouTube permissions"
      action={<ConnectButton label="Try again" />}
    >
      <p>
        On Google&apos;s consent screen, leave both boxes ticked: viewing your YouTube account and
        viewing your YouTube Analytics reports.
      </p>
      <p>
        Soundcheck reads your videos and how each audience watched them. Without both, it can&apos;t
        learn anything. Access is read-only and you can disconnect at any time.
      </p>
    </Notice>
  );
}
