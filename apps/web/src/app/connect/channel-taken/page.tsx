import { Notice } from "@/components/notice";

export default function ChannelTakenPage() {
  return (
    <Notice title="This channel is already connected">
      <p>
        Another Google account has already connected this channel to Soundcheck. Sign in with that
        account, or disconnect the channel there first.
      </p>
    </Notice>
  );
}
