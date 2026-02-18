import type { PipelineEvent } from "@/types/pipeline";

interface EventLogProps {
  events: PipelineEvent[];
}

const KIND_COLORS: Record<string, string> = {
  progress: "var(--status-running)",
  done: "var(--status-done)",
  error: "var(--status-failed)",
};

export function EventLog({ events }: EventLogProps) {
  const sorted = [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          Event Log
        </h2>
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {sorted.map((event) => (
          <div key={event.id} className="px-4 py-2 border-b border-[hsl(var(--border)/.3)] flex items-start gap-3 text-xs">
            <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
              {new Date(event.created_at).toLocaleTimeString()}
            </span>
            <span
              className="shrink-0 uppercase font-semibold tracking-wider w-16"
              style={{ color: `hsl(${KIND_COLORS[event.kind] ?? "var(--foreground)"})` }}
            >
              {event.kind}
            </span>
            <span className="text-[hsl(var(--foreground)/.8)] truncate">{event.message}</span>
            {event.progress != null && (
              <span className="ml-auto shrink-0 text-[hsl(var(--muted-foreground))]">{event.progress}%</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
