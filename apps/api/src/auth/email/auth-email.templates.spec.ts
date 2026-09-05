import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderAuthEmail } from './auth-email.templates.js';

void describe('auth email templates', () => {
  void it('renders purpose-specific copy and escapes the HTML action URL', () => {
    const verification = renderAuthEmail({
      recipientEmail: 'angler@example.ru',
      purpose: 'EMAIL_VERIFICATION',
      actionUrl: 'https://example.ru/verify-email#token=a&b',
      expiresAt: new Date(),
    });
    const reset = renderAuthEmail({
      recipientEmail: 'angler@example.ru',
      purpose: 'PASSWORD_RESET',
      actionUrl: 'https://example.ru/reset-password#token=value',
      expiresAt: new Date(),
    });

    assert.match(verification.subject, /Подтвердите email/u);
    assert.match(verification.html, /token=a&amp;b/u);
    assert.match(reset.subject, /Сброс пароля/u);
    assert.match(reset.text, /1 час/u);
  });
});
