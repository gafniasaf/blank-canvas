import { useState, useEffect } from "react";
import type { Book, PipelineJob, PipelineEvent } from "@/types/pipeline";
import { MOCK_BOOKS, MOCK_JOBS, MOCK_EVENTS } from "@/data/mock-pipeline";

export function useBooks() {
  const [books, setBooks] = useState<Book[]>(MOCK_BOOKS);
  return { books, setBooks };
}

export function useJobs() {
  const [jobs, setJobs] = useState<PipelineJob[]>(MOCK_JOBS);
  return { jobs, setJobs };
}

export function useEvents() {
  const [events, setEvents] = useState<PipelineEvent[]>(MOCK_EVENTS);

  useEffect(() => {
    // Simulate new events arriving
    const interval = setInterval(() => {
      setEvents((prev) => {
        const running = MOCK_JOBS.find((j) => j.status === "running");
        if (!running) return prev;
        const progress = Math.min(100, (prev[prev.length - 1]?.progress ?? 0) + Math.floor(Math.random() * 8 + 2));
        const newEvent: PipelineEvent = {
          id: `e-${Date.now()}`,
          job_id: running.id,
          book_id: running.book_id,
          kind: progress >= 100 ? "done" : "progress",
          progress,
          message: progress >= 100 ? `${running.step} completed` : `${running.step} — ${progress}%`,
          created_at: new Date().toISOString(),
        };
        return [...prev.slice(-49), newEvent];
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return { events };
}
