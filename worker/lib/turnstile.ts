import { z } from "zod";
import type { Bindings } from "../env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const verifyResponseSchema = z.object({ success: z.boolean() });

// Cloudflare Turnstile gates the sign-in flow against bots. Like the OAuth seam,
// verification is skipped in local/e2e (gated on ENVIRONMENT, never reachable in
// production). In production it is an OPTIONAL hardening layer: when
// TURNSTILE_SECRET_KEY is unset the check is a no-op (fail open — the feature is
// simply off, mirroring the Telegram-token pattern), so a missing optional secret
// can never brick login. The frontend only renders the widget when the matching
// site key is present, so token presence and verification stay in lockstep.
export async function verifyTurnstile(
  env: Bindings,
  token: string | undefined,
): Promise<boolean> {
  if (env.ENVIRONMENT === "local" || env.ENVIRONMENT === "e2e") {
    return true;
  }
  const secret = env.TURNSTILE_SECRET_KEY;
  if (secret === undefined || secret === "") {
    return true;
  }
  if (token === undefined || token === "") {
    return false;
  }
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) {
      return false;
    }
    return verifyResponseSchema.parse(await res.json()).success;
  } catch {
    return false;
  }
}
