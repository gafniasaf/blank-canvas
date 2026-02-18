/**
 * Pipeline data hooks — connected to live Supabase.
 *
 * Ignite Zero policy: NO MOCK DATA.
 * If Supabase is not connected, hooks return empty arrays.
 * The UI shows a "Connect Supabase" prompt, not fake data.
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase-client";
import type { Book, PipelineJob, PipelineEvent } from "@/types/pipeline";

export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBooks = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("book_registry")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("[useBooks] Supabase error:", error.message);
    }
    if (data) setBooks(data as Book[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBooks(); }, [fetchBooks]);

  return { books, loading, refetch: fetchBooks };
}

export function useJobs(bookId?: string) {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("pipeline_jobs")
      .select("*")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (bookId) query = query.eq("book_id", bookId);
    const { data, error } = await query;
    if (error) {
      console.error("[useJobs] Supabase error:", error.message);
    }
    if (data) setJobs(data as PipelineJob[]);
    setLoading(false);
  }, [bookId]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Realtime subscription for live updates
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("pipeline_jobs_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_jobs" },
        () => { fetchJobs(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchJobs]);

  return { jobs, loading, refetch: fetchJobs };
}

export function useEvents(bookId?: string, limit = 50) {
  const [events, setEvents] = useState<PipelineEvent[]>([]);

  const fetchEvents = useCallback(async () => {
    if (!supabase) return;
    let query = supabase
      .from("pipeline_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (bookId) query = query.eq("book_id", bookId);
    const { data, error } = await query;
    if (error) {
      console.error("[useEvents] Supabase error:", error.message);
    }
    if (data) setEvents(data as PipelineEvent[]);
  }, [bookId, limit]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Realtime subscription for streaming events
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("pipeline_events_stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pipeline_events" },
        (payload) => {
          const evt = payload.new as PipelineEvent;
          if (!bookId || evt.book_id === bookId) {
            setEvents((prev) => [evt, ...prev].slice(0, limit));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [bookId, limit, fetchEvents]);

  return { events };
}
