import type { PipelineJob } from "@/types/pipeline";

interface StatsBarProps {
  jobs: PipelineJob[];
}

export function StatsBar({ jobs }: StatsBarProps) {
  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  jobs.forEach((j) => counts[j.status]++);

  const stats = [
    { label: "Pending", value: counts.pending, color: "var(--status-pending)" },
    { label: "Running", value: counts.running, color: "var(--status-running)" },
    { label: "Done", value: counts.done, color: "var(--status-done)" },
    { label: "Failed", value: counts.failed, color: "var(--status-failed)" },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg p-4">
          <div className="text-xs uppercase tracking-widest" style={{ color: `hsl(${s.color})` }}>
            {s.label}
          </div>
          <div className="text-2xl font-bold mt-1" style={{ color: `hsl(${s.color})` }}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
