import { createHash } from 'node:crypto';
import { customerEmail, customerName } from '../customers/customer.validation';
import type { NewLeadInput } from '../leads/lead.service';
import { normalizeMobile } from '../../utils/mobile';
import { ValidationError } from '../../utils/errors';

type JsonObject = Record<string, unknown>;

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const firstText = (payload: JsonObject, keys: string[]) => {
  for (const key of keys) {
    const value = text(payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const invalid = (field: string, message: string): never => {
  throw new ValidationError([{ field, message }]);
};

const fallbackId = (values: { mobile: string; propertyName: string; message?: string | null; enquiryType?: string | null; createdAt: Date }) => {
  const input = JSON.stringify({
    mobile: values.mobile,
    propertyName: values.propertyName.replace(/\s+/g, ' ').trim().toLowerCase(),
    message: values.message ?? null,
    enquiryType: values.enquiryType ?? null,
    createdAt: values.createdAt.toISOString(),
  });
  return `mb-fallback:${createHash('sha256').update(input).digest('hex')}`;
};

/**
 * Provisional adapter for the URL-only Magicbricks integration.
 * The exact vendor contract is intentionally isolated here until Magicbricks supplies a sample payload.
 */
export function mapMagicbricksPayload(payload: unknown): NewLeadInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid('', 'Payload must be a JSON object');
  const value = payload as JsonObject;

  const name = firstText(value, ['name', 'customerName', 'customer_name']) ?? invalid('name', 'Customer name is required');
  const nameResult = customerName.safeParse(name);
  if (!nameResult.success) invalid('name', 'Customer name is invalid');

  const rawMobile = firstText(value, ['mobile', 'phone', 'phoneNumber', 'mobileNumber']) ?? invalid('mobile', 'Mobile number is required');
  const mobile = normalizeMobile(rawMobile) ?? invalid('mobile', 'Mobile number is invalid');

  const propertyName = firstText(value, ['propertyName', 'projectName', 'property_name', 'project_name']) ?? invalid('propertyName', 'Property or project name is required');
  if (propertyName.length > 200) invalid('propertyName', 'Property or project name is too long');

  const rawEmail = firstText(value, ['email', 'emailAddress', 'email_address']);
  let email: string | null | undefined;
  if (rawEmail !== undefined) {
    const result = customerEmail.safeParse(rawEmail);
    if (!result.success) invalid('email', 'Email must be valid');
    email = result.data;
  }

  const rawType = firstText(value, ['enquiryType', 'enquiry_type', 'enquiry', 'transactionType'])?.toUpperCase();
  const enquiryType = rawType === undefined ? undefined : rawType === 'RENT' || rawType === 'LEASE' ? 'RENT' : rawType === 'BUY' || rawType === 'SALE' || rawType === 'SELL' ? 'BUY' : invalid('enquiryType', 'Enquiry type must be sale/buy or rental');
  const message = firstText(value, ['message', 'comments', 'customerEnquiry', 'customer_enquiry']);
  if (message && message.length > 2000) invalid('message', 'Message is too long');

  const externalLeadId = firstText(value, ['externalLeadId', 'external_lead_id', 'leadId', 'lead_id']);
  if (externalLeadId && externalLeadId.length > 100) invalid('externalLeadId', 'External lead id is too long');

  const externalPropertyId = firstText(value, ['externalPropertyId', 'external_property_id', 'propertyId', 'property_id', 'listingId', 'listing_id', 'listingPropertyId', 'listing_property_id']);
  if (externalPropertyId && externalPropertyId.length > 200) invalid('externalPropertyId', 'External property id is too long');
  const externalPropertyUrl = firstText(value, ['externalPropertyUrl', 'external_property_url', 'propertyUrl', 'property_url', 'listingUrl', 'listing_url']);
  if (externalPropertyUrl && externalPropertyUrl.length > 1000) invalid('externalPropertyUrl', 'External property url is too long');

  const rawCreatedAt = firstText(value, ['createdAt', 'created_at', 'leadCreatedAt', 'lead_created_at']);
  let externalCreatedAt: Date | undefined;
  if (rawCreatedAt !== undefined) {
    externalCreatedAt = new Date(rawCreatedAt);
    if (Number.isNaN(externalCreatedAt.getTime())) invalid('createdAt', 'Lead creation timestamp is invalid');
  }

  return {
    name: nameResult.data!,
    mobile,
    email,
    propertyName,
    externalPropertyId,
    externalPropertyName: propertyName,
    externalPropertyUrl,
    source: 'MAGICBRICKS',
    enquiryType,
    message,
    externalLeadId: externalLeadId ?? (externalCreatedAt ? fallbackId({ mobile, propertyName, message, enquiryType, createdAt: externalCreatedAt }) : undefined),
    externalCreatedAt,
    rawPayload: payload,
  };
}
