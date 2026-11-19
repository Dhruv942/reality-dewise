import { env } from '../../config/env';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const plain = (value: unknown) => String(value ?? 'Not available').replace(/[\r\n]+/g, ' ').trim() || 'Not available';

const enquiryLabel = (value: string | null | undefined) => ({ RENT: 'Rent', BUY: 'Sale', PROJECT: 'Project' }[value ?? ''] ?? 'Not available');
const money = (value: number | string | null | undefined) => value === null || value === undefined ? 'Not available' : `₹${new Intl.NumberFormat('en-IN').format(Number(value))}`;

export function assignmentEmail(input: {
  executiveName: string;
  leadName: string;
  leadNo: string;
  leadType?: string | null;
  mobile?: string | null;
  email?: string | null;
  projectName?: string | null;
  propertyName: string;
  enquiryType?: string | null;
  budget?: number | string | null;
  source: string;
  assignedAt: Date;
}) {
  const name = escapeHtml(input.executiveName);
  const leadName = escapeHtml(input.leadName);
  const leadNo = escapeHtml(input.leadNo);
  const leadType = escapeHtml(input.leadType ?? 'Not available');
  const mobile = escapeHtml(input.mobile ?? 'Not available');
  const email = escapeHtml(input.email ?? 'Not available');
  const project = escapeHtml(input.projectName ?? input.propertyName);
  const property = escapeHtml(input.propertyName);
  const enquiry = escapeHtml(enquiryLabel(input.enquiryType));
  const budget = escapeHtml(money(input.budget));
  const source = escapeHtml(input.source);
  const assignedAt = escapeHtml(input.assignedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  const leadUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/leads/${encodeURIComponent(input.leadNo)}`;
  const htmlContent = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937"><p>Hello ${name},</p><p>A new lead has been assigned to you in Realty Adwise CRM.</p><h3>Lead Details</h3><p><strong>Name:</strong> ${leadName}<br><strong>Type:</strong> ${leadType}<br><strong>Number:</strong> ${mobile}<br><strong>Email ID:</strong> ${email}<br><strong>Project Name:</strong> ${project}<br><strong>Property Name:</strong> ${property}<br><strong>Enquiry:</strong> ${enquiry}<br><strong>Budget:</strong> ${budget}<br><strong>Lead ID:</strong> ${leadNo}<br><strong>Source:</strong> ${source}<br><strong>Date:</strong> ${assignedAt}</p><p>Please log in to Realty Adwise CRM to review the lead details and take the necessary action.</p><p><a href="${leadUrl}">View Lead</a></p><p>Regards,<br>Realty Adwise CRM Team</p></div>`;
  const textContent = `Hello ${plain(input.executiveName)},\n\nA new lead has been assigned to you in Realty Adwise CRM.\n\nLead Details\nName: ${plain(input.leadName)}\nType: ${plain(input.leadType)}\nNumber: ${plain(input.mobile)}\nEmail ID: ${plain(input.email)}\nProject Name: ${plain(input.projectName ?? input.propertyName)}\nProperty Name: ${plain(input.propertyName)}\nEnquiry: ${enquiryLabel(input.enquiryType)}\nBudget: ${money(input.budget)}\nLead ID: ${plain(input.leadNo)}\nSource: ${plain(input.source)}\nDate: ${plain(assignedAt)}\n\nView Lead: ${leadUrl}\n\nRegards,\nRealty Adwise CRM Team`;
  return { subject: 'New Lead Assigned | Realty Adwise CRM', htmlContent, textContent };
}
