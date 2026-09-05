import type { AuthEmailMessage } from './auth-email.transport.js';

export interface RenderedAuthEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderAuthEmail(message: AuthEmailMessage): RenderedAuthEmail {
  const isVerification = message.purpose === 'EMAIL_VERIFICATION';
  const subject = isVerification ? 'Подтвердите email — Рыбная база' : 'Сброс пароля — Рыбная база';
  const instruction = isVerification
    ? 'Подтвердите email, чтобы завершить регистрацию.'
    : 'Откройте ссылку, чтобы задать новый пароль.';
  const expiry = isVerification ? '24 часа' : '1 час';
  const safeUrl = escapeHtml(message.actionUrl);

  return {
    subject,
    text: `${instruction}\n\n${message.actionUrl}\n\nСсылка действует ${expiry}. Если вы не запрашивали это письмо, проигнорируйте его.`,
    html: `<p>${instruction}</p><p><a href="${safeUrl}">Продолжить</a></p><p>Ссылка действует ${expiry}. Если вы не запрашивали это письмо, проигнорируйте его.</p>`,
  };
}
