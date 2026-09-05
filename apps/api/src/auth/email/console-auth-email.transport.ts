import { Injectable, Logger } from '@nestjs/common';
import type { AuthEmailMessage, AuthEmailTransport } from './auth-email.transport.js';

@Injectable()
export class ConsoleAuthEmailTransport implements AuthEmailTransport {
  private readonly logger = new Logger(ConsoleAuthEmailTransport.name);

  send(message: AuthEmailMessage): Promise<void> {
    this.logger.log(
      `[development auth email] ${message.purpose} to ${message.recipientEmail}: ${message.actionUrl}`,
    );
    return Promise.resolve();
  }
}
