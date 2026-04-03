import Link from "next/link";
import type { Paper } from "@/types/paper";

interface TakeawayState {
  takeaways: string[];
  loading: boolean;
}

function TakeawaysBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-950 dark:text-violet-400">
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        className="opacity-70"
      >
        <path
          d="M8 1.5a4.5 4.5 0 0 0-1.5 8.74V12a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.76A4.5 4.5 0 0 0 8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M6.5 14h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      AI takeaways
    </span>
  );
}

function TakeawaysLoading() {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <div className="h-3 w-3 animate-spin rounded-full border border-zinc-300 border-t-violet-500 dark:border-zinc-600 dark:border-t-violet-400" />
      <span className="text-xs text-zinc-400 dark:text-zinc-500">
        Generating takeaways…
      </span>
    </div>
  );
}

function TakeawaysList({ takeaways }: { takeaways: string[] }) {
  if (takeaways.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-violet-100 bg-violet-50/50 px-3 py-2.5 dark:border-violet-900/50 dark:bg-violet-950/30">
      <div className="mb-1.5">
        <TakeawaysBadge />
      </div>
      <ul className="space-y-1">
        {takeaways.map((t, i) => (
          <li
            key={i}
            className="flex gap-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300"
          >
            <span className="mt-0.5 shrink-0 text-violet-400 dark:text-violet-500">
              •
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PublicationType({ type }: { type: string }) {
  const colors: Record<string, string> = {
    Review: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    JournalArticle: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    Conference: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    Preprint: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  };

  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[type] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
    >
      {type}
    </span>
  );
}

export function PaperCard({
  paper,
  query,
  takeaway,
}: {
  paper: Paper;
  query?: string;
  takeaway?: TakeawayState;
}) {
  const authorList = paper.authors?.slice(0, 3).map((a) => a.name).join(", ");
  const hasMore = (paper.authors?.length ?? 0) > 3;

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {paper.publication_type && (
          <PublicationType type={paper.publication_type} />
        )}
        {paper.year && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {paper.year}
          </span>
        )}
        {paper.is_open_access && (
          <span className="text-xs font-medium text-green-600 dark:text-green-400">
            Open Access
          </span>
        )}
      </div>

      <h3 className="mb-1 text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
        <Link
          href={`/paper/${paper.s2_id}${query ? `?q=${encodeURIComponent(query)}` : ""}`}
          className="hover:underline"
        >
          {paper.title}
        </Link>
      </h3>

      {authorList && (
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          {authorList}
          {hasMore && " et al."}
        </p>
      )}

      {paper.journal && (
        <p className="mb-2 text-sm italic text-zinc-500 dark:text-zinc-500">
          {paper.journal}
        </p>
      )}

      {paper.abstract && (
        <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {paper.abstract}
        </p>
      )}

      {/* Takeaways */}
      {takeaway?.loading && <TakeawaysLoading />}
      {takeaway && !takeaway.loading && takeaway.takeaways.length > 0 && (
        <TakeawaysList takeaways={takeaway.takeaways} />
      )}

      <div className="flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        {paper.citation_count != null && (
          <span>{paper.citation_count.toLocaleString()} citations</span>
        )}
        {paper.reference_count != null && (
          <span>{paper.reference_count.toLocaleString()} references</span>
        )}
        {paper.doi && (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:underline"
          >
            {paper.doi}
          </a>
        )}
      </div>

      {paper.fields_of_study && paper.fields_of_study.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {paper.fields_of_study.map((field) => (
            <span
              key={field}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {field}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
