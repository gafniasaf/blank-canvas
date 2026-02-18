import type { PipelineJob } from "@/types/pipeline";
import type { JobStatus } from "@/types/pipeline";

interface StatsBarProps {
  jobs: PipelineJob[];
}

const STAT_CONFIG: { status: JobStatus; label: string; dotClass: string }[] = [
  { status: "running", label: "Running", dotClass: "bg-status-running animate-status-pulse" },
  { status: "claimed", label: "Claimed", dotClass: "bg-status-claimed" },
  { status: "pending", label: "Pending", dotClass: "bg-status-pending" },
  { status: "done", label: "Done", dotClass: "bg-status-done" },
  { status: "failed", label: "Failed", dotClass: "bg-status-failed" },
];

export function StatsBar({ jobs }: StatsBarProps) {
  const counts: Record<string, number> = {};
  for (const j of jobs) {
    counts[j.status] = (counts[j.status] || 0) + 1;
  }

  return (
    <div className="flex flex-wrap gap-4">
      {STAT_CONFIG.map(({ status, label, dotClass }) => (
        <div
          key={status}
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 min-w-[120px]"
        >
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <div>
            <p className="text-2xl font-bold text-card-foreground leading-none">
              {counts[status] || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
