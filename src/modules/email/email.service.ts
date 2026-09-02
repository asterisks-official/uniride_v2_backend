import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface EmailSendResult {
  ok: boolean;
  skipped: boolean; // true when Resend isn't configured (no API key)
  id?: string;
  error?: string;
}

/**
 * The only domain UniRide sends mail from.
 *
 * Every outbound message — verification codes and password resets alike — has
 * to come from here. Two reasons, and the second is the one that bites:
 *
 * 1. SPF, DKIM and DMARC are published for this domain and nowhere else. A
 *    sender on any other domain is either unauthenticated or rejected outright.
 * 2. A password-reset code *is* the reset. A student who learns to accept one
 *    from an unfamiliar sender has been trained into the exact behaviour a
 *    phishing attempt relies on.
 *
 * The address itself stays configurable — a `noreply@`, a `support@` and a
 * future `receipts@` are all legitimate — but the domain is not.
 */
export const EMAIL_DOMAIN = 'uniridebd.com';

/** Default sender, used when RESEND_FROM_EMAIL is absent. */
const DEFAULT_FROM = `UniRide <noreply@${EMAIL_DOMAIN}>`;

/**
 * The domain part of a `From` header, in either form Resend accepts:
 * `noreply@example.com` or `UniRide <noreply@example.com>`.
 *
 * Returns null when nothing that looks like an address is present, which is
 * itself a misconfiguration worth reporting.
 */
export function senderDomain(from: string): string | null {
  const match = /<?([^\s<>@]+)@([^\s<>]+?)>?\s*$/.exec(from.trim());
  return match ? match[2].toLowerCase() : null;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;
  private readonly from: string;
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('resend.apiKey');
    this.from = this.config.get<string>('resend.fromEmail', DEFAULT_FROM);
    this.isDev = this.config.get<string>('nodeEnv') !== 'production';

    // Checked at boot rather than per-send: a wrong sender domain is a
    // deployment mistake, and the useful moment to hear about it is when the
    // container starts, not scattered across every registration that follows.
    //
    // Logged rather than thrown. Refusing to boot would take the whole API
    // down over mail configuration, which is a worse outage than sending from
    // the wrong address — but this is loud enough to act on, and env
    // validation already rejects a bad value before it reaches here.
    const domain = senderDomain(this.from);
    if (domain !== EMAIL_DOMAIN) {
      this.logger.error(
        `RESEND_FROM_EMAIL is "${this.from}" (domain: ${domain ?? 'unparseable'}). ` +
          `All UniRide mail must be sent from @${EMAIL_DOMAIN} — ` +
          `anything else is unauthenticated by SPF/DKIM and will be spam-filed or rejected.`,
      );
    }

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn(
        'RESEND_API_KEY not set — emails will be logged only (dev mode)',
      );
    }
  }

  async sendVerificationOtp(
    email: string,
    name: string,
    otp: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: 'Verify your UniRide email',
      html: this.buildOtpTemplate({
        name,
        otp,
        title: 'Email Verification',
        message:
          'Use the code below to verify your email address. It expires in 10 minutes.',
        footer:
          'If you did not create a UniRide account, you can safely ignore this email.',
      }),
    });
  }

  async sendPasswordResetOtp(
    email: string,
    name: string,
    otp: string,
  ): Promise<void> {
    await this.send({
      to: email,
      subject: 'Reset your UniRide password',
      html: this.buildOtpTemplate({
        name,
        otp,
        title: 'Password Reset',
        message:
          'Use the code below to reset your password. It expires in 10 minutes.',
        footer:
          'If you did not request a password reset, please ignore this email.',
      }),
    });
  }

  private async send(msg: {
    to: string;
    subject: string;
    html: string;
  }): Promise<EmailSendResult> {
    if (this.isDev) {
      this.logger.log(`[DEV EMAIL] To: ${msg.to} | Subject: ${msg.subject}`);
    }

    if (!this.resend) return { ok: false, skipped: true };

    // Email delivery must never break the calling flow (e.g. registration):
    // the Resend SDK can both return an `error` object and throw on network
    // failures, so swallow both and only log.
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
      });

      if (error) {
        this.logger.error(
          `Failed to send email to ${msg.to}: ${error.message}`,
        );
        return { ok: false, skipped: false, error: error.message };
      }
      return { ok: true, skipped: false, id: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Email send threw for ${msg.to}`,
        err instanceof Error ? err.stack : String(err),
      );
      return { ok: false, skipped: false, error: message };
    }
  }

  private buildOtpTemplate(opts: {
    name: string;
    otp: string;
    title: string;
    message: string;
    footer: string;
  }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#2563EB;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">UniRide</h1>
              <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px;">University Ride Sharing</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:600;">${opts.title}</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">Hi ${opts.name},</p>
              <p style="margin:0 0 32px;color:#374151;font-size:15px;line-height:1.6;">${opts.message}</p>

              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center" style="background:#eff6ff;border:2px dashed #93c5fd;border-radius:8px;padding:24px;">
                    <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Your verification code</p>
                    <p style="margin:0;color:#1d4ed8;font-size:40px;font-weight:700;letter-spacing:8px;">${opts.otp}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6;">${opts.footer}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; 2026 UniRide · University Ride Sharing Platform</p>
              <p style="margin:6px 0 0;color:#9ca3af;font-size:12px;">This email was sent by uniridebd.com. UniRide will never ask you for your code.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
