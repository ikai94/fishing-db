import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { describe, it } from 'node:test';
import { SmtpAuthEmailTransport } from './smtp-auth-email.transport.js';

void describe('SmtpAuthEmailTransport', () => {
  void it('applies TLS, certificate verification and timeouts to the actual SMTP connection', () => {
    const transport = new SmtpAuthEmailTransport(
      new ConfigService({
        NODE_ENV: 'production',
        EMAIL_FROM: 'no-reply@example.ru',
        SMTP_URL: 'smtp://user:pass@smtp.example.ru:587',
      }),
    );
    const options = (
      transport as unknown as {
        transporter: { transporter: { options: Record<string, unknown> } };
      }
    ).transporter.transporter.options;

    assert.equal(options.requireTLS, true);
    assert.deepEqual(options.tls, { rejectUnauthorized: true });
    assert.equal(options.connectionTimeout, 10_000);
    assert.equal(options.greetingTimeout, 10_000);
    assert.equal(options.socketTimeout, 20_000);
    assert.equal(options.logger, false);
    assert.equal(options.debug, false);
  });
});
