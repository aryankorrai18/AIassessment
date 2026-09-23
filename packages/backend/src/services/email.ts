import { env } from "../config/env";
import { logger } from "../lib/logger";

// EmailJS over HTTPS, deliberately — the deployment network blocks raw SMTP
// sockets. Template merge variables: to_email, subject, message_html, message_text.
const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";
const SEND_TIMEOUT_MS = 15_000;

export interface EmailMessage { to: string; subject: string; html: string; text: string }
export interface EmailResult { sent: boolean; previewUrl: string | null }

const isConfigured = () => Boolean(env.emailjs.serviceId && env.emailjs.templateId && env.emailjs.publicKey);

/** Never throws — a delivery failure must never fail the request that triggered it. */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (!isConfigured()) {
    logger.info({ to: message.to, subject: message.subject }, `EmailJS not configured — email logged instead of sent:\n${message.text}`);
    return { sent: false, previewUrl: null };
  }
  try {
    const res = await fetch(EMAILJS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: env.emailjs.serviceId,
        template_id: env.emailjs.templateId,
        user_id: env.emailjs.publicKey,
        ...(env.emailjs.privateKey ? { accessToken: env.emailjs.privateKey } : {}),
        template_params: { to_email: message.to, subject: message.subject, message_html: message.html, message_text: message.text },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ to: message.to, status: res.status, body: (await res.text()).slice(0, 300) }, "EmailJS rejected the email");
      return { sent: false, previewUrl: null };
    }
    return { sent: true, previewUrl: null };
  } catch (err) {
    logger.warn({ err, to: message.to }, "Email delivery failed");
    return { sent: false, previewUrl: null };
  }
}

export function candidatePortalUrl(): string {
  const origin = env.corsOrigin ?? env.corsOrigins[env.corsOrigins.length - 1];
  return `${origin.replace(/\/+$/, "")}/interview/login`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function formatWhen(date: Date): string {
  return date.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
}

export function accessKeyEmail(p: { to: string; name: string; empId: string; key: string; scheduledAt: Date }): EmailMessage {
  const url = candidatePortalUrl();
  const when = formatWhen(p.scheduledAt);
  const text = [
    `Hi ${p.name},`,
    "",
    `Your GapVise AI assessment is scheduled for ${when}.`,
    "",
    `Portal:       ${url}`,
    `Employee ID:  ${p.empId}`,
    `Access key:   ${p.key}`,
    "",
    "The key works for one attempt only. Use a laptop or desktop with a working camera and microphone,",
    "close other applications, and make sure your internet connection is stable before you begin.",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(p.name)},</p>
<p>Your GapVise AI assessment is scheduled for <strong>${escapeHtml(when)}</strong>.</p>
<table cellpadding="4">
<tr><td>Portal</td><td><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td></tr>
<tr><td>Employee ID</td><td><code>${escapeHtml(p.empId)}</code></td></tr>
<tr><td>Access key</td><td><code style="font-size:16px;letter-spacing:1px">${escapeHtml(p.key)}</code></td></tr>
</table>
<p>The key works for one attempt only. Use a laptop or desktop with a working camera and microphone, close other applications, and make sure your internet connection is stable before you begin.</p>`;
  return { to: p.to, subject: "Your GapVise AI assessment access key", html, text };
}

export function reminderEmail(p: { to: string; name: string; empId: string; scheduledAt: Date; reminderNumber: number }): EmailMessage {
  const url = candidatePortalUrl();
  const when = formatWhen(p.scheduledAt);
  const text = [
    `Hi ${p.name},`,
    "",
    `This is reminder ${p.reminderNumber} of 3: your GapVise AI assessment was scheduled for ${when} and hasn't been started yet.`,
    "",
    `Portal:       ${url}`,
    `Employee ID:  ${p.empId}`,
    "Access key:   the 12-character key from your original invitation email",
    "",
    "If you've lost the key, contact the hiring team to have a new one sent.",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(p.name)},</p>
<p>This is reminder <strong>${p.reminderNumber} of 3</strong>: your GapVise AI assessment was scheduled for <strong>${escapeHtml(when)}</strong> and hasn't been started yet.</p>
<p>Sign in at <a href="${escapeHtml(url)}">${escapeHtml(url)}</a> with Employee ID <code>${escapeHtml(p.empId)}</code> and the access key from your original invitation email.</p>
<p>If you've lost the key, contact the hiring team to have a new one sent.</p>`;
  return { to: p.to, subject: `Reminder ${p.reminderNumber}/3: your GapVise AI assessment is waiting`, html, text };
}

export function noShowEscalationEmail(p: { to: string; candidateName: string; empId: string; empEmail: string; scheduledAt: Date }): EmailMessage {
  const when = formatWhen(p.scheduledAt);
  const text = [
    `${p.candidateName} (${p.empId}, ${p.empEmail}) has been marked NO_SHOW.`,
    "",
    `Their assessment was scheduled for ${when}. Three reminders were sent with no attempt started.`,
    "Reschedule or re-send their key from Admin → Interview Schedule if they should still be assessed.",
  ].join("\n");
  const html = `<p><strong>${escapeHtml(p.candidateName)}</strong> (${escapeHtml(p.empId)}, ${escapeHtml(p.empEmail)}) has been marked <strong>NO_SHOW</strong>.</p>
<p>Their assessment was scheduled for ${escapeHtml(when)}. Three reminders were sent with no attempt started.</p>
<p>Reschedule or re-send their key from Admin → Interview Schedule if they should still be assessed.</p>`;
  return { to: p.to, subject: `No-show: ${p.candidateName} (${p.empId})`, html, text };
}

export function passwordResetEmail(p: { to: string; name: string; url: string; expiresMinutes: number }): EmailMessage {
  const text = [
    `Hi ${p.name},`,
    "",
    "Someone (hopefully you) asked to reset the password for your GapVise AI admin account.",
    `Open this link within ${p.expiresMinutes} minutes to choose a new password:`,
    "",
    p.url,
    "",
    "The link works once. If you didn't ask for this, ignore this email — your password stays the same.",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(p.name)},</p>
<p>Someone (hopefully you) asked to reset the password for your GapVise AI admin account. Open this link within ${p.expiresMinutes} minutes to choose a new password:</p>
<p><a href="${escapeHtml(p.url)}">Reset your password</a></p>
<p>The link works once. If you didn't ask for this, ignore this email — your password stays the same.</p>`;
  return { to: p.to, subject: "Reset your GapVise AI admin password", html, text };
}
