"use client";

import { Button } from "@soundcheck/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Calls DELETE /api/v1/channels/{id} after a confirmation, then refreshes the page. */
export function DeleteChannelButton({ channelId, title }: { channelId: string; title: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "deleting" | "failed">("idle");

  async function onDelete() {
    const confirmed = window.confirm(
      `Disconnect ${title} and delete all of its data from Soundcheck? Access to your channel is revoked. This cannot be undone.`,
    );
    if (!confirmed) return;
    setState("deleting");
    const response = await fetch(`/api/v1/channels/${encodeURIComponent(channelId)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      router.refresh();
    } else {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={onDelete} disabled={state === "deleting"}>
        {state === "deleting" ? "Deleting…" : "Disconnect and delete data"}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="text-sm">
          Deletion did not finish. Nothing was lost; try again.
        </p>
      ) : null}
    </div>
  );
}
