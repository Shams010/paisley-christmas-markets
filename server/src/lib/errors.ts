// Every API error is { error, message }, plus a fields map when particular form fields are wrong, e.g. "fields": { "postcode": "Enter a valid UK postcode" }.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new ApiError(404, 'not_found', what);

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', 'Some fields need attention.', fields);
}

// The database raises business-rule errors with a short code as the message
const RULES: Record<string, { status: number; message: string; field?: string }> = {
  not_authenticated: { status: 401, message: 'Log in first.' },
  forbidden: { status: 403, message: 'You do not have permission to do that.' },
  forbidden_field: { status: 403, message: 'Only an administrator can change that.' },
  immutable_field: { status: 403, message: 'That part of an application cannot be changed.' },
  admin_cannot_edit_application: { status: 403, message: 'Administrators can change the status and note only.' },
  market_not_found: { status: 404, message: 'Market not found.' },
  application_not_found: { status: 404, message: 'Application not found.' },
  applications_closed: { status: 409, message: 'Applications for this market are closed.' },
  application_exists: { status: 409, message: 'You already have an application for this market.' },
  application_locked: { status: 409, message: 'This application can no longer be edited.' },
  invalid_status_transition: { status: 409, message: 'An application cannot move to that status from its current one.' },
  application_not_approved: { status: 409, message: 'Only approved applications can be given a stall.' },
  day_not_requested: { status: 409, message: 'The trader did not apply for that market day.' },
  invalid_category: { status: 422, message: 'Choose one of the listed categories', field: 'category' },
  invalid_stall_type: { status: 422, message: 'Choose one of the listed stall types', field: 'stall_type' },
  invalid_market_days: { status: 422, message: 'Choose from the published market days', field: 'market_days' },
  insurance_expires_too_early: {
    status: 422,
    message: 'Insurance must be valid until after the last market day',
    field: 'insurance_expiry',
  },
  food_registration_required: {
    status: 422,
    message: 'Upload your food business registration',
    field: 'food_registration',
  },
  admin_note_required: {
    status: 422,
    message: 'Give the trader a reason when rejecting or requesting changes',
    field: 'admin_note',
  },
};

interface DatabaseError {
  code?: string;
  message: string;
  details?: string | null;
}

/** Converts an error returned by Supabase into the API's error shape. */
export function fromDatabase(error: DatabaseError): ApiError {
  const code = error.code ?? '';

  if (code === 'P0001') {
    const rule = RULES[error.message];
    if (rule) {
      return rule.field
        ? validationFailed({ [rule.field]: rule.message })
        : new ApiError(rule.status, error.message, rule.message);
    }
    if (error.message === 'invalid_upload') {
      // The detail names the field whose file could not be found.
      return validationFailed({ [error.details ?? 'file']: 'Upload this file again' });
    }
    return new ApiError(400, error.message, error.details ?? 'The request could not be completed.');
  }

  switch (code) {
    case '23505':
      return new ApiError(409, 'conflict', 'That would create a duplicate: it has already been taken or recorded.');
    case '23503':
      return new ApiError(422, 'invalid_reference', 'That refers to something that does not exist in this market.');
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
      return new ApiError(422, 'validation_failed', 'One of the values was not accepted.');
    case '42501':
      return new ApiError(403, 'forbidden', 'You do not have permission to do that.');
    case 'PGRST116':
      return notFound();
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return new ApiError(401, 'invalid_token', 'Your session has expired. Log in again.');
    default:
      // Unknown database error. Log it here and keep the response generic.
      console.error('Unexpected database error', error);
      return new ApiError(500, 'server_error', 'Something went wrong on our side.');
  }
}

/** Unwraps a Supabase response, throwing the API's own error type on failure. */
export function unwrap<T>(result: { data: T | null; error: DatabaseError | null }): T {
  if (result.error) throw fromDatabase(result.error);
  return result.data as T;
}
