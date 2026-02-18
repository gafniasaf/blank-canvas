import { useBooks, useJobs, useEvents } from "@/hooks/use-pipeline";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { JobTable } from "@/components/dashboard/JobTable";
import { EventLog } from "@/components/dashboard/EventLog";

export default function Index() {
  const { books } = useBooks();
  const { jobs } = useJobs();
  const { events } = useEvents();

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--foreground))]">
            BookGen Pipeline
          </h1>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {books.length} books · {jobs.length} jobs · demo mode
          </p>
        </div>
        <div className="text-xs text-[hsl(var(--status-pending))] bg-[hsl(var(--status-pending)/.1)] border border-[hsl(var(--status-pending)/.3)] px-3 py-1 rounded">
          ⚠ No backend connected
        </div>
      </header>

      <StatsBar jobs={jobs} />
      <JobTable jobs={jobs} />
      <EventLog events={events} />
    </div>
  );
}
