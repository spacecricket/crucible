"use client";

import { useState, type FormEvent } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  placeholder?: string;
  size?: "lg" | "md";
  initialQuery?: string;
}

export function SearchBar({
  onSearch,
  isLoading,
  placeholder = "Is high LDL bad for the heart?",
  size = "md",
  initialQuery = "",
}: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      onSearch(trimmed);
    }
  }

  const inputSize = size === "lg" ? "h-14 text-lg px-5" : "h-11 text-base px-4";
  const buttonSize = size === "lg" ? "h-14 px-6 text-base" : "h-11 px-5 text-sm";

  return (
    <form onSubmit={handleSubmit} className="flex w-full gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={`flex-1 rounded-lg border border-zinc-300 bg-white font-sans outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400 ${inputSize}`}
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={isLoading || !query.trim()}
        className={`rounded-lg bg-zinc-900 font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${buttonSize}`}
      >
        {isLoading ? "Searching..." : "Search"}
      </button>
    </form>
  );
}
