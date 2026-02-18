import { AlertCircle, CheckCircle2, Activity, MessageSquare, Heart } from "lucide-react";
import type { PipelineEvent } from "@/types/pipeline";

const EVENT_ICONS: Record<string, React.ReactNode> = {
  progress: <Activity className="h-3.5 w-3.5 text-status-running" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-status-done" />,
  error: <AlertCircle className="h-3.5 w-3.5 text-status-failed" />,
  log: <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />,
  heartbeat: <Heart className="h-3.5 w-3.5 text-status-claimed" />,
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface EventLogProps {
  events: PipelineEvent[];
}

export function EventLog({ events }: EventLogProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
        No events yet.
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-[400px] overflow-y-auto">
      {events.map((evt) => (
        <div
          key={evt.id}
          className="flex items-start gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
        >
          <span className="mt-0.5 shrink-0">
            {EVENT_ICONS[evt.event_type] ?? EVENT_ICONS.log}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-card-foreground">
              {evt.message || `${evt.event_type} event`}
            </p>
            {evt.progress != null && (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${evt.progress}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {evt.progress}%
                </span>
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {formatTime(evt.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
