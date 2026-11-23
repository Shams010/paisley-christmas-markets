// Application form schema, shared by the API. If a field changes, update the migrations too.
import { z } from 'zod';

export const POWER_REQUIREMENTS = ['none', 'one_socket', 'two_plus_sockets', 'high_load'] as const;

export const APPLICATION_STATUSES = [
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The parts of a market that the form depends on (returned by GET /api/market). */
export interface MarketFormConfig {
  categories: { code: string; label: string; requires_food_registration: boolean }[];
  stall_types: { code: string; label: string }[];
  /** Market days as YYYY-MM-DD strings. */
  market_days: string[];
  /** The last day of the market, YYYY-MM-DD. Insurance must run past it. */
  end_date: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

/** "pa28ab" -> "PA2 8AB" */
export function normalisePostcode(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function isUkPostcode(value: string): boolean {
  return UK_POSTCODE.test(value.toUpperCase().replace(/\s+/g, ''));
}

/** Accepts 07700 900123, 0141 496 0000, +44 7700 900123 and similar. */
function isUkPhone(value: string): boolean {
  const compact = value.replace(/[\s\-()]/g, '');
  return /^(?:\+44|0)\d{9,10}$/.test(compact);
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const required = (label: string) => `${label} is required`;

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: required(label) })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

// HTML forms send '' for an empty field, so '' and null both count as not given.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

const optionalHttpsLink = optional(
  z.string().trim().max(200, 'Link must be at most 200 characters').refine(isHttpsUrl, 'Enter a link starting with https://'),
);

const optionalUpload = optional(z.string().trim().min(3).max(300));

// Built per market because categories, stall types and dates differ between markets.
export function buildApplicationSchema(market: MarketFormConfig) {
  const categoryCodes = market.categories.map((c) => c.code);
  const stallTypeCodes = market.stall_types.map((s) => s.code);

  return z
    .object({
      business_name: text('Business name', 2, 80),
      contact_name: text('Contact name', 2, 80),
      phone: z.string({ error: required('Phone number') }).trim().refine(isUkPhone, 'Enter a UK phone number'),
      postcode: z
        .string({ error: required('Postcode') })
        .trim()
        .refine(isUkPostcode, 'Enter a valid UK postcode')
        .transform(normalisePostcode),
      category: z
        .string({ error: required('Category') })
        .refine((value) => categoryCodes.includes(value), 'Choose one of the listed categories'),
      description: text('Description', 20, 500),
      stall_type: z
        .string({ error: required('Stall type') })
        .refine((value) => stallTypeCodes.includes(value), 'Choose one of the listed stall types'),
      needs_power: z.boolean({ error: 'Say whether you need power' }),
      power_requirement: z.enum(POWER_REQUIREMENTS, { error: 'Choose a power requirement' }),
      market_days: z
        .array(z.string(), { error: 'Choose at least one day' })
        .min(1, 'Choose at least one day')
        .refine((days) => days.every((day) => market.market_days.includes(day)), 'Choose from the published market days')
        .transform((days) => [...new Set(days)].sort()),
      insurance_expiry: z
        .string({ error: required('Insurance expiry date') })
        .refine(isRealDate, 'Enter a date as YYYY-MM-DD')
        .refine((value) => value > market.end_date, 'Insurance must be valid until after the last market day'),
      website_url: optionalHttpsLink,
      social_link: optionalHttpsLink,
      additional_requirements: optional(z.string().trim().max(300, 'Keep this to 300 characters or fewer')),
      food_registration: optionalUpload,
      uses_lpg: z.boolean().default(false),
      gas_safety_certificate: optionalUpload,
      logo: optionalUpload,
      is_over_18: z.literal(true, { error: 'You must confirm you are 18 or over' }),
      accept_privacy_policy: z.literal(true, { error: 'You must accept the privacy notice' }),
      marketing_opt_in: z.boolean().default(false),
    })
    .superRefine((form, ctx) => {
      if (form.needs_power !== (form.power_requirement !== 'none')) {
        ctx.addIssue({
          code: 'custom',
          path: ['power_requirement'],
          message: form.needs_power
            ? 'Choose how much power you need'
            : 'Choose "none" if you do not need power',
        });
      }

      const category = market.categories.find((c) => c.code === form.category);
      if (category?.requires_food_registration) {
        if (!form.food_registration) {
          ctx.addIssue({
            code: 'custom',
            path: ['food_registration'],
            message: 'Upload your food business registration',
          });
        }
        if (form.uses_lpg && !form.gas_safety_certificate) {
          ctx.addIssue({
            code: 'custom',
            path: ['gas_safety_certificate'],
            message: 'Upload your gas safety certificate',
          });
        }
      }
    });
}

export type ApplicationInput = z.infer<ReturnType<typeof buildApplicationSchema>>;

// Flattens Zod issues to { field: message }, keeping only the first message per field.
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    if (!(field in fields)) fields[field] = issue.message;
  }
  return fields;
}
