import type { PipelineJob } from "@/types/pipeline";
import { StatusBadge } from "./StatusBadge";

interface JobTableProps {
  jobs: PipelineJob[];
}

export function JobTable({ jobs }: JobTableProps) {
  const sorted = [...jobs].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          Pipeline Jobs
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Step</th>
              <th className="px-4 py-2">Chapter</th>
              <th className="px-4 py-2">Attempts</th>
              <th className="px-4 py-2">Updated</th>
              <th className="px-4 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((job) => (
              <tr key={job.id} className="border-b border-[hsl(var(--border)/.5)] hover:bg-[hsl(var(--muted)/.5)] transition-colors">
                <td className="px-4 py-2.5"><StatusBadge status={job.status} /></td>
                <td className="px-4 py-2.5 font-mono text-[hsl(var(--foreground))]">{job.step}</td>
                <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))]">{job.chapter ?? "—"}</td>
                <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))]">{job.attempts}</td>
                <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))]">{new Date(job.updated_at).toLocaleTimeString()}</td>
                <td className="px-4 py-2.5 text-[hsl(var(--status-failed))] text-xs max-w-[200px] truncate">{job.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
