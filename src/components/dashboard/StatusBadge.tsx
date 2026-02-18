import type { PipelineJob } from "@/types/pipeline";

const STATUS_STYLES: Record<PipelineJob["status"], string> = {
  pending: "bg-[hsl(var(--status-pending)/.15)] text-[hsl(var(--status-pending))] border-[hsl(var(--status-pending)/.3)]",
  running: "bg-[hsl(var(--status-running)/.15)] text-[hsl(var(--status-running))] border-[hsl(var(--status-running)/.3)] animate-pulse-status",
  done: "bg-[hsl(var(--status-done)/.15)] text-[hsl(var(--status-done))] border-[hsl(var(--status-done)/.3)]",
  failed: "bg-[hsl(var(--status-failed)/.15)] text-[hsl(var(--status-failed))] border-[hsl(var(--status-failed)/.3)]",
};

export function StatusBadge({ status }: { status: PipelineJob["status"] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold uppercase tracking-wider border rounded ${STATUS_STYLES[status]}`}>
      {status === "running" && <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />}
      {status}
    </span>
  );
}
