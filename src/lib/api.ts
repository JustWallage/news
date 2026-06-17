import type { ZodType } from "zod";

class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** All API access goes through here: fetch + zod-parse, no exceptions. */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      `Request to ${path} failed (${res.status})`,
    );
  }
  return schema.parse(await res.json());
}

export const jsonInit = (
  method: "POST" | "PATCH" | "PUT",
  body: unknown,
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
