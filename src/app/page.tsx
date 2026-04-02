"use client";

import { useRouter } from "next/navigation";
import { SearchBar } from "@/components/search-bar";

export default function Home() {
  const router = useRouter();

  function handleSearch(query: string) {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Crucible
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Evaluate scientific claims by tracing evidence through citation
            graphs.
          </p>
        </div>

        <SearchBar onSearch={handleSearch} isLoading={false} size="lg" />

        <div className="flex flex-wrap justify-center gap-2">
          {[
            "Is high LDL bad for the heart?",
            "Do SSRIs cause weight gain?",
            "Does creatine improve cognition?",
          ].map((example) => (
            <button
              key={example}
              onClick={() => handleSearch(example)}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
