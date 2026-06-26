import type { Bindings } from "../env";

// The transactional-email seam. Routes send through this interface so they can be
// unit-tested with a fake, mirroring the Google OAuth seam in oauth.ts.
export interface EmailSender {
  sendLoginCode(to: string, code: string, link: string): Promise<void>;
}

function loginEmail(
  code: string,
  link: string,
): { html: string; text: string } {
  const text = `Your sign-in code is ${code}\n\nIt expires in 10 minutes. Enter it on the sign-in screen, or just open this link to sign in:\n${link}\n\nIf you didn't request this, you can ignore this email.`;
  const html = `<p>Your sign-in code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:16px 0">${code}</p>
<p>It expires in 10 minutes. Enter it on the sign-in screen, or <a href="${link}">click here to sign in</a>.</p>
<p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p>`;
  return { html, text };
}

function makeRealEmailSender(send: SendEmail, from: string): EmailSender {
  return {
    sendLoginCode: async (to, code, link) => {
      const { html, text } = loginEmail(code, link);
      await send.send({
        to,
        from: { email: from, name: "News" },
        subject: `Your sign-in code: ${code}`,
        html,
        text,
      });
    },
  };
}

// Local/e2e stand-in: never touches the EMAIL binding (which those envs do not
// configure). The request route surfaces the code via its `devCode` response
// field there, so nothing needs to be delivered.
const fakeEmailSender: EmailSender = {
  sendLoginCode: () => Promise.resolve(),
};

// Security-critical, same shape as makeGoogleAuth: the fake is used ONLY in
// local/e2e. Production (and any unknown ENVIRONMENT) requires the EMAIL binding
// and EMAIL_FROM, returning null — a fail-closed 503 at the route — when either
// is absent, so a misconfigured deploy can never silently drop sign-in emails.
export function makeEmailSender(env: Bindings): EmailSender | null {
  if (env.ENVIRONMENT === "local" || env.ENVIRONMENT === "e2e") {
    return fakeEmailSender;
  }
  const from = env.EMAIL_FROM;
  if (env.EMAIL === undefined || from === undefined || from === "") {
    return null;
  }
  return makeRealEmailSender(env.EMAIL, from);
}
