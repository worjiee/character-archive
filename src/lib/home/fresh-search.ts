export type FreshWindow = "24h" | "week";
export type FreshSort = "freshest" | "oldest";

export interface FreshSearchState {
  window: FreshWindow;
  sort: FreshSort;
}

export function parseFreshSearchParams(
  params: Record<string, string | string[] | undefined>,
): FreshSearchState {
  const windowValue = firstValue(params.window);
  const sortValue = firstValue(params.sort);
  return {
    window: windowValue === "week" ? "week" : "24h",
    sort: sortValue === "oldest" ? "oldest" : "freshest",
  };
}

export function freshHref(input: FreshSearchState): string {
  const params = new URLSearchParams();
  if (input.window !== "24h") params.set("window", input.window);
  if (input.sort !== "freshest") params.set("sort", input.sort);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
