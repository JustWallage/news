import { z, type ZodType } from "zod";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const errorBodySchema = z.object({ error: z.string() });

// The worker's error responses carry a user-safe `{ error }` message; surface
// it when present so callers can show it verbatim.
async function errorMessage(path: string, res: Response): Promise<string> {
  try {
    return errorBodySchema.parse(await res.json()).error;
  } catch {
    return `Request to ${path} failed (${String(res.status)})`;
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
    throw new ApiRequestError(res.status, await errorMessage(path, res));
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
