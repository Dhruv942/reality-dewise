import { z } from 'zod';

export const testEmailSchema = z.strictObject({
  toAddress: z.email('A valid recipient email is required'),
});

export const notificationSettingSchema = z.strictObject({
  enabled: z.boolean(),
});

export const notificationIdParam = z.strictObject({ id: z.uuid('Invalid notification id') });
