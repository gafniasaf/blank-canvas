import { useState } from "react";
import { BookOpen, Activity, Zap, AlertCircle } from "lucide-react";
import { useBooks, useJobs, useEvents } from "@/hooks/use-pipeline";
import { isSupabaseConnected } from "@/lib/supabase-client";
import { BookCard } from "@/components/dashboard/BookCard";
import { JobTable } from "@/components/dashboard/JobTable";
import { EventLog } from "@/components/dashboard/EventLog";
import { StatsBar } from "@/components/dashboard/StatsBar";

function ConnectionBanner() {
  return (
    <div className="rounded-lg border border-yellow-300/50 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800/50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
            Supabase not connected
          </h3>
          <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
            Set <code className="font-mono bg-yellow-100 dark:bg-yellow-900/50 px-1 rounded">VITE_SUPABASE_URL</code> and{" "}
            <code className="font-mono bg-yellow-100 dark:bg-yellow-900/50 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> in
            your environment to connect to live data. No mock data is shown per Ignite Zero policy.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Index() {
  const [selectedBookId, setSelectedBookId] = useState<string | undefined>();
  const { books, loading: booksLoading } = useBooks();
  const { jobs, loading: jobsLoading } = useJobs(selectedBookId);
  const { events } = useEvents(selectedBookId);
  const connected = isSupabaseConnected();

  const selectedBook = books.find((b) => b.book_id === selectedBookId);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <Zap className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-card-foreground leading-none">
                  BookGen Pipeline
                </h1>
                <p className="text-xs text-muted-foreground">
                  {connected ? (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                      Connected
                    </span>
                  ) : (
                    "Not connected"
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Connection warning */}
        {!connected && <ConnectionBanner />}

        {/* Stats */}
        <StatsBar jobs={jobs} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Book Registry - Left Panel */}
          <section className="lg:col-span-4 space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Book Registry
              </h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {booksLoading ? "loading..." : `${books.length} books`}
              </span>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => setSelectedBookId(undefined)}
                className={`w-full text-left rounded-lg border p-3 text-sm transition-all ${
                  !selectedBookId
                    ? "border-primary bg-primary/5 font-medium text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30"
                }`}
              >
                All books
              </button>

              {books.map((book) => (
                <BookCard
                  key={book.book_id}
                  book={book}
                  isSelected={selectedBookId === book.book_id}
                  onClick={() =>
                    setSelectedBookId(
                      selectedBookId === book.book_id ? undefined : book.book_id
                    )
                  }
                />
              ))}

              {!booksLoading && books.length === 0 && connected && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
                  No books registered yet.
                  <br />
                  <span className="text-xs">
                    Use <code className="font-mono">npx tsx cli/enqueue.ts</code> or the MCP server to register books.
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Main Panel - Jobs + Events */}
          <section className="lg:col-span-8 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                  Pipeline Jobs
                  {selectedBook ? ` — ${selectedBook.title}` : ""}
                </h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  {jobsLoading ? "loading..." : `${jobs.length} jobs`}
                </span>
              </div>
              <JobTable jobs={jobs} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                  Event Stream
                </h2>
              </div>
              <div className="rounded-lg border border-border bg-card p-1">
                <EventLog events={events} />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
