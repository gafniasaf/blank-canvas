import { Book } from "lucide-react";
import type { Book as BookType } from "@/types/pipeline";
import { StatusBadge } from "./StatusBadge";

interface BookCardProps {
  book: BookType;
  isSelected: boolean;
  onClick: () => void;
}

export function BookCard({ book, isSelected, onClick }: BookCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-4 transition-all hover:shadow-md ${
        isSelected
          ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Book className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-card-foreground truncate">{book.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {book.book_id} · {book.chapters.length} chapters · {book.level.toUpperCase()}
            </p>
          </div>
        </div>
        <StatusBadge status={book.status} />
      </div>
      {book.isbn && (
        <p className="text-xs text-muted-foreground mt-2 font-mono">{book.isbn}</p>
      )}
    </button>
  );
}
