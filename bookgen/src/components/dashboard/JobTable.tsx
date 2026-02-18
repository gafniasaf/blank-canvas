import { Clock, AlertTriangle, Cpu } from "lucide-react";
import type { PipelineJob } from "@/types/pipeline";
import { STEP_LABELS } from "@/types/pipeline";
import { StatusBadge } from "./StatusBadge";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface JobRowProps {
  job: PipelineJob;
}

export function JobRow({ job }: JobRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50">
      {/* Step + target */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-card-foreground">
            {STEP_LABELS[job.step]}
          </span>
          {job.chapter != null && (
            <span className="text-xs text-muted-foreground">
              Ch.{job.chapter}
              {job.section ? ` §${job.section}` : ""}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
          {job.id.slice(0, 8)}
        </p>
      </div>

      {/* Status */}
      <StatusBadge status={job.status} />

      {/* Worker */}
      <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground w-28">
        {job.worker_id ? (
          <>
            <Cpu className="h-3 w-3" />
            <span className="truncate">{job.worker_id}</span>
          </>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </div>

      {/* Attempts */}
      <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground w-16">
        {job.attempts > 0 && (
          <>
            {job.status === "failed" ? (
              <AlertTriangle className="h-3 w-3 text-status-failed" />
            ) : null}
            <span>
              {job.attempts}/{job.max_attempts}
            </span>
          </>
        )}
      </div>

      {/* Time */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground w-20 justify-end">
        <Clock className="h-3 w-3" />
        <span>{timeAgo(job.updated_at)}</span>
      </div>
    </div>
  );
}

interface JobTableProps {
  jobs: PipelineJob[];
}

export function JobTable({ jobs }: JobTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
        No pipeline jobs found.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </div>
  );
}
