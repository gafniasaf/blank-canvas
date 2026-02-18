/**
 * Supabase Storage helpers for artifact upload/download.
 */

import { adminSupabase } from "./supabase.js";

const BUCKET = "books";

export async function downloadJson<T = unknown>(storagePath: string): Promise<T> {
  const { data, error } = await adminSupabase().storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Storage download failed (${BUCKET}/${storagePath}): ${error?.message ?? "no data"}`);
  }
  const text = await data.text();
  return JSON.parse(text) as T;
}

export async function uploadJson(storagePath: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const { error } = await adminSupabase().storage.from(BUCKET).upload(storagePath, blob, {
    upsert: true,
    contentType: "application/json",
  });
  if (error) {
    throw new Error(`Storage upload failed (${BUCKET}/${storagePath}): ${error.message}`);
  }
}

export async function uploadFile(storagePath: string, content: Buffer | Blob, contentType: string): Promise<void> {
  const { error } = await adminSupabase().storage.from(BUCKET).upload(storagePath, content, {
    upsert: true,
    contentType,
  });
  if (error) {
    throw new Error(`Storage upload failed (${BUCKET}/${storagePath}): ${error.message}`);
  }
}

export async function storageExists(storagePath: string): Promise<boolean> {
  try {
    const { data, error } = await adminSupabase().storage.from(BUCKET).download(storagePath);
    return !error && !!data;
  } catch {
    return false;
  }
}

export function artifactPath(bookId: string, bookVersionId: string, ...segments: string[]): string {
  return `books/${bookId}/${bookVersionId}/${segments.join("/")}`;
}

