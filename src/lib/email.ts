import nodemailer, { type Transporter } from "nodemailer";

export interface Mail {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

let transport: Transporter | undefined;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
  }
  return transport;
}

/**
 * Sends one message. Throws on transport failure; callers decide whether that is fatal.
 * MAIL_DRIVER=log prints instead of sending (tests, environments without SMTP).
 */
export async function sendMail(mail: Mail) {
  if ((process.env.MAIL_DRIVER ?? "smtp") === "log") {
    console.log(`[mail:log] to=${Array.isArray(mail.to) ? mail.to.join(",") : mail.to} subject="${mail.subject}" attachments=${mail.attachments?.length ?? 0}`);
    return;
  }
  await getTransport().sendMail({ from: process.env.MAIL_FROM ?? "compliance@example.com", ...mail });
}

/** Everyone who gets every alert in addition to the credential holder. */
export function alertCcList(): string[] {
  return (process.env.ALERT_CC ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
