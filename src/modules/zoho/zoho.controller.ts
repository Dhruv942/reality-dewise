import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { parse } from '../../utils/validate';
import * as service from './zoho.service';
import { listRecentFailures } from '../email-notifications/email-notification.service';
import { testEmailSchema } from './zoho.validation';
import { notificationIdParam, notificationSettingSchema } from './zoho.validation';
import { retry as retryEmail, setNotificationEnabled } from '../email-notifications/email-notification.service';

const text = (value: unknown) => typeof value === 'string' ? value : undefined;

export async function connect(req: Request, res: Response) {
  res.redirect(await service.beginConnect(req.user!.id));
}

export async function callback(req: Request, res: Response) {
  try {
    await service.completeCallback({ code: text(req.query.code), state: text(req.query.state), error: text(req.query.error) });
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, '')}/settings/email-integration?zoho=connected`);
  } catch (err) {
    console.error('Zoho OAuth callback failed:', err instanceof Error ? err.message : 'unknown error');
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, '')}/settings/email-integration?zoho=error`);
  }
}

export async function status(_req: Request, res: Response) {
  res.json({ ...(await service.getStatus()), recentFailures: await listRecentFailures() });
}

export async function disconnect(_req: Request, res: Response) {
  await service.disconnect();
  res.json({ success: true, status: 'DISCONNECTED' });
}

export async function testEmail(req: Request, res: Response) {
  const input = parse(testEmailSchema, req.body);
  res.json({ success: true, ...(await service.sendTestEmail(input.toAddress)) });
}

export async function updateNotificationSetting(req: Request, res: Response) {
  const input = parse(notificationSettingSchema, req.body);
  await setNotificationEnabled(input.enabled);
  res.json({ success: true, notificationEnabled: input.enabled });
}

export async function retryNotification(req: Request, res: Response) {
  const { id } = parse(notificationIdParam, req.params);
  if (!(await retryEmail(id))) return res.status(404).json({ success: false, message: 'Failed email notification not found' });
  res.json({ success: true, status: 'QUEUED' });
}
