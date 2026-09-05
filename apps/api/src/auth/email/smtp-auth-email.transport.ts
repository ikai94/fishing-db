import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AuthEmailMessage, AuthEmailTransport } from './auth-email.transport.js';
import { renderAuthEmail } from './auth-email.templates.js';

@Injectable()
export class SmtpAuthEmailTransport implements AuthEmailTransport {
  private readonly from: string;
  private readonly transporter: Transporter;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.from = configService.getOrThrow<string>('EMAIL_FROM');
    const url = new URL(configService.getOrThrow<string>('SMTP_URL'));
    this.transporter = nodemailer.createTransport({
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)),
      secure: url.protocol === 'smtps:',
      ...(url.username
        ? {
            auth: {
              user: decodeURIComponent(url.username),
              pass: decodeURIComponent(url.password),
            },
          }
        : {}),
      requireTLS: configService.getOrThrow<string>('NODE_ENV') === 'production',
      tls: { rejectUnauthorized: true },
      logger: false,
      debug: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: AuthEmailMessage): Promise<void> {
    const rendered = renderAuthEmail(message);

    await this.transporter.sendMail({
      from: this.from,
      to: message.recipientEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }
}
