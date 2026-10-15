"use client";

import type { Percentiles } from "@soundcheck/core/schemas";
import { useState } from "react";
import { CutExports } from "@/components/cut-exports";
import { CutStrip } from "@/components/cut-strip";
import { EditPanel } from "@/components/edit-panel";
import { marksFor, type Objective } from "@/lib/edits";
import { SAMPLE_BEATS, SAMPLE_SOUNDCHECK } from "./samples";

const EDITS = SAMPLE_SOUNDCHECK.edits;

/** Sample data: the ticked edits' own effects added up, standing in for a simulation. */
const added = (deltas: Percentiles[]): Percentiles => ({
  p10: deltas.reduce((sum, delta) => sum + delta.p10, 0),
  p50: deltas.reduce((sum, delta) => sum + delta.p50, 0),
  p90: deltas.reduce((sum, delta) => sum + delta.p90, 0),
});

/** The edit panel, the cut strip and the exports with ticks, without the API. */
export function EditDemo() {
  const [objective, setObjective] = useState<Objective>("avd");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(["move-3-to-5"]));
  const chosen = EDITS.filter((edit) => ticked.has(edit.editId));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-6">
        <CutStrip
          beats={SAMPLE_BEATS}
          durationS={212}
          marks={marksFor(chosen)}
          onSeek={() => undefined}
        />
        <CutExports
          title={SAMPLE_SOUNDCHECK.title ?? "Sample"}
          edits={chosen}
          beats={SAMPLE_BEATS}
          durationS={212}
          chapters={SAMPLE_SOUNDCHECK.chapters}
          spans={null}
          editedDurationS={212}
        />
      </div>
      <EditPanel
        edits={EDITS}
        objective={objective}
        onObjective={setObjective}
        ticked={ticked}
        onToggle={(editId) =>
          setTicked((current) => {
            const next = new Set(current);
            if (!next.delete(editId)) next.add(editId);
            return next;
          })
        }
        recommending={{ kind: "all" }}
        together={
          chosen.length
            ? {
                avdS: added(chosen.map((edit) => edit.deltaAvdS)),
                avpPp: added(chosen.map((edit) => edit.deltaAvpPp)),
              }
            : null
        }
        pending={false}
        error={null}
      />
    </div>
  );
}
