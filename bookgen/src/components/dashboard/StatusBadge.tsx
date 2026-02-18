import type { JobStatus, BookStatus } from "@/types/pipeline";

const STATUS_CLASSES: Record<JobStatus | BookStatus, string> = {
  pending: "bg-status-pending/15 text-status-pending border-status-pending/30",
  claimed: "bg-status-claimed/15 text-status-claimed border-status-claimed/30",
  running: "bg-status-running/15 text-status-running border-status-running/30 animate-status-pulse",
  done: "bg-status-done/15 text-status-done border-status-done/30",
  failed: "bg-status-failed/15 text-status-failed border-status-failed/30",
  cancelled: "bg-status-cancelled/15 text-status-cancelled border-status-cancelled/30",
  draft: "bg-muted text-muted-foreground border-border",
  ingesting: "bg-status-claimed/15 text-status-claimed border-status-claimed/30 animate-status-pulse",
  generating: "bg-status-running/15 text-status-running border-status-running/30 animate-status-pulse",
  complete: "bg-status-done/15 text-status-done border-status-done/30",
};

const DOT_CLASSES: Record<string, string> = {
  pending: "bg-status-pending",
  claimed: "bg-status-claimed",
  running: "bg-status-running animate-status-pulse",
  done: "bg-status-done",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
  draft: "bg-muted-foreground",
  ingesting: "bg-status-claimed animate-status-pulse",
  generating: "bg-status-running animate-status-pulse",
  complete: "bg-status-done",
};

interface StatusBadgeProps {
  status: JobStatus | BookStatus;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_CLASSES[status]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[status]}`} />
      {status}
    </span>
  );
}
