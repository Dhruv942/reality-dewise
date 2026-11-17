import { env } from '../../config/env';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const plain = (value: unknown) => String(value ?? 'Not available').replace(/[\r\n]+/g, ' ').trim() || 'Not available';

export function assignmentEmail(input: { executiveName: string; leadName: string; leadNo: string; propertyName: string; source: string; assignedAt: Date }) {
  const name = escapeHtml(input.executiveName);
  const leadName = escapeHtml(input.leadName);
  const leadNo = escapeHtml(input.leadNo);
  const property = escapeHtml(input.propertyName);
  const source = escapeHtml(input.source);
  const assignedAt = escapeHtml(input.assignedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  const leadUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/leads/${encodeURIComponent(input.leadNo)}`;
  const htmlContent = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937"><p>Hello ${name},</p><p>A new lead has been assigned to you in Realty Adwise CRM.</p><h3>Lead Details</h3><p><strong>Lead Name:</strong> ${leadName}<br><strong>Lead No:</strong> ${leadNo}<br><strong>Property / Project:</strong> ${property}<br><strong>Lead Source:</strong> ${source}<br><strong>Assigned Date:</strong> ${assignedAt}</p><p>Please log in to Realty Adwise CRM to review the lead details and take the necessary action.</p><p><a href="${leadUrl}">View Lead</a></p><p>Regards,<br>Realty Adwise CRM Team</p></div>`;
  const textContent = `Hello ${plain(input.executiveName)},\n\nA new lead has been assigned to you in Realty Adwise CRM.\n\nLead Details\nLead Name: ${plain(input.leadName)}\nLead No: ${plain(input.leadNo)}\nProperty / Project: ${plain(input.propertyName)}\nLead Source: ${plain(input.source)}\nAssigned Date: ${plain(assignedAt)}\n\nView Lead: ${leadUrl}\n\nRegards,\nRealty Adwise CRM Team`;
  return { subject: 'New Lead Assigned | Realty Adwise CRM', htmlContent, textContent };
}
