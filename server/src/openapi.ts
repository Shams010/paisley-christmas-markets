// OpenAPI 3.1 description, served at /api/openapi.json and rendered at /api/docs.
const bearer = [{ bearerAuth: [] }];

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const json = (schema: object, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});

const marketParam = {
  name: 'market',
  in: 'query',
  required: false,
  description: 'Market slug. Defaults to the site\'s own market.',
  schema: { type: 'string', example: 'paisley' },
};

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

const body = (ref: string) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Market Platform API',
    version: '1.0.0',
    description:
      'REST API for the Paisley Christmas Markets proof of concept. Public routes need no login. ' +
      'Trader and administrator routes need the access token from Supabase Auth: ' +
      '`Authorization: Bearer <token>`.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Public', description: 'No login needed' },
    { name: 'Trader', description: 'Logged-in traders' },
    { name: 'My data', description: 'Data protection rights' },
    { name: 'Admin', description: 'Administrators of a market' },
    { name: 'System' },
  ],
  paths: {
    '/health': {
      get: { tags: ['System'], summary: 'Is the API running?', responses: { 200: json({ type: 'object' }) } },
    },
    '/market': {
      get: {
        tags: ['Public'],
        summary: 'Market details, branding and the lists the application form needs',
        parameters: [marketParam],
        responses: { 200: json({ $ref: '#/components/schemas/Market' }), 404: error('Unknown market') },
      },
    },
    '/market-days': {
      get: {
        tags: ['Public'],
        summary: 'Dates and opening times',
        parameters: [marketParam],
        responses: { 200: json({ type: 'array', items: { $ref: '#/components/schemas/MarketDay' } }) },
      },
    },
    '/traders': {
      get: {
        tags: ['Public'],
        summary: 'Traders directory (approved traders only)',
        parameters: [marketParam, { name: 'category', in: 'query', schema: { type: 'string', example: 'crafts_gifts' } }],
        responses: { 200: json({ type: 'array', items: { $ref: '#/components/schemas/Trader' } }) },
      },
    },
    '/traders/{id}': {
      get: {
        tags: ['Public'],
        summary: 'One trader listing',
        parameters: [idParam, marketParam],
        responses: { 200: json({ $ref: '#/components/schemas/Trader' }), 404: error('Not found') },
      },
    },
    '/stall-map': {
      get: {
        tags: ['Public'],
        summary: 'Every stall for one day, with the trader on it if allocated',
        parameters: [marketParam, { name: 'day', in: 'query', schema: { type: 'string', format: 'date' } }],
        responses: { 200: json({ type: 'object' }), 404: error('Not a market day') },
      },
    },
    '/announcements': {
      get: { tags: ['Public'], summary: 'Published announcements', parameters: [marketParam], responses: { 200: json({ type: 'array', items: { type: 'object' } }) } },
    },
    '/enquiries': {
      post: {
        tags: ['Public'],
        summary: 'Contact form, including data protection concerns',
        parameters: [marketParam],
        requestBody: body('Enquiry'),
        responses: { 201: json({ type: 'object' }, 'Received'), 422: error('Validation failed') },
      },
    },
    '/applications': {
      post: {
        tags: ['Trader'],
        summary: 'Submit the application form',
        security: bearer,
        parameters: [marketParam],
        requestBody: body('ApplicationForm'),
        responses: {
          201: json({ $ref: '#/components/schemas/ApplicationReceipt' }, 'Submitted'),
          401: error('Not logged in'),
          409: error('Applications closed, or you already have an application'),
          422: error('Validation failed'),
        },
      },
    },
    '/applications/me': {
      get: {
        tags: ['Trader'],
        summary: 'My applications for this market',
        security: bearer,
        parameters: [marketParam],
        responses: { 200: json({ type: 'array', items: { $ref: '#/components/schemas/Application' } }), 401: error('Not logged in') },
      },
    },
    '/applications/{id}': {
      patch: {
        tags: ['Trader'],
        summary: 'Edit my application (send the whole form)',
        description: 'Allowed while the status is submitted or changes_requested.',
        security: bearer,
        parameters: [idParam],
        requestBody: body('ApplicationForm'),
        responses: { 200: json({ type: 'object' }), 404: error('Not found'), 409: error('Locked'), 422: error('Validation failed') },
      },
    },
    '/applications/{id}/withdrawal': {
      post: {
        tags: ['Trader'],
        summary: 'Withdraw my application before a decision',
        security: bearer,
        parameters: [idParam],
        responses: { 200: json({ type: 'object' }), 404: error('Not found'), 409: error('Already decided') },
      },
    },
    '/me/data': {
      get: {
        tags: ['My data'],
        summary: 'Everything held about me (right of access)',
        security: bearer,
        parameters: [{ name: 'download', in: 'query', schema: { type: 'boolean' }, description: 'true = send as a file' }],
        responses: { 200: json({ type: 'object' }), 401: error('Not logged in') },
      },
    },
    '/me': {
      patch: {
        tags: ['My data'],
        summary: 'Correct my contact details (rectification)',
        security: bearer,
        requestBody: body('Profile'),
        responses: { 200: json({ type: 'object' }), 422: error('Validation failed') },
      },
      delete: {
        tags: ['My data'],
        summary: 'Delete my account and all my data (erasure)',
        security: bearer,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['confirm'], properties: { confirm: { const: 'DELETE' } } } } },
        },
        responses: { 200: json({ type: 'object', properties: { deleted: { type: 'boolean' } } }), 422: error('Confirmation missing') },
      },
    },
    '/me/consents/marketing': {
      put: {
        tags: ['My data'],
        summary: 'Give or withdraw consent to marketing emails',
        security: bearer,
        parameters: [marketParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['granted'], properties: { granted: { type: 'boolean' } } } } },
        },
        responses: { 200: json({ type: 'object' }) },
      },
    },
    '/admin/applications': {
      get: {
        tags: ['Admin'],
        summary: 'Review queue',
        security: bearer,
        parameters: [
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/Status' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: json({ type: 'array', items: { $ref: '#/components/schemas/Application' } }), 403: error('Administrators only') },
      },
    },
    '/admin/applications/{id}': {
      get: {
        tags: ['Admin'],
        summary: 'One application with email, document links and history',
        security: bearer,
        parameters: [idParam],
        responses: { 200: json({ type: 'object' }), 404: error('Not found') },
      },
    },
    '/admin/applications/{id}/status': {
      patch: {
        tags: ['Admin'],
        summary: 'Start review, approve, reject or request changes',
        description: 'submitted -> under_review -> approved | rejected | changes_requested. A note is required to reject or request changes.',
        security: bearer,
        parameters: [idParam],
        requestBody: body('StatusChange'),
        responses: { 200: json({ type: 'object' }), 404: error('Not found'), 409: error('Move not allowed'), 422: error('Note required') },
      },
    },
    '/admin/allocations': {
      post: {
        tags: ['Admin'],
        summary: 'Allocate a stall to an approved trader for one day',
        security: bearer,
        requestBody: body('Allocation'),
        responses: { 201: json({ type: 'object' }, 'Allocated'), 409: error('Stall taken, trader not approved, or day not requested') },
      },
    },
    '/admin/allocations/{id}': {
      delete: { tags: ['Admin'], summary: 'Remove an allocation', security: bearer, parameters: [idParam], responses: { 204: { description: 'Removed' }, 404: error('Not found') } },
    },
    '/admin/stats': {
      get: { tags: ['Admin'], summary: 'Dashboard totals', security: bearer, responses: { 200: json({ type: 'object' }) } },
    },
    '/admin/audit-log': {
      get: {
        tags: ['Admin'],
        summary: 'Who did what',
        security: bearer,
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }],
        responses: { 200: json({ type: 'array', items: { type: 'object' } }) },
      },
    },
    '/admin/enquiries': {
      get: {
        tags: ['Admin'],
        summary: 'Contact form messages',
        security: bearer,
        parameters: [
          { name: 'type', in: 'query', schema: { enum: ['general', 'feedback', 'data_protection'] } },
          { name: 'status', in: 'query', schema: { enum: ['new', 'acknowledged', 'closed'] } },
        ],
        responses: { 200: json({ type: 'array', items: { type: 'object' } }) },
      },
    },
    '/admin/enquiries/{id}': {
      patch: {
        tags: ['Admin'],
        summary: 'Acknowledge or close an enquiry',
        security: bearer,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { enum: ['acknowledged', 'closed'] } } } } },
        },
        responses: { 200: json({ type: 'object' }), 404: error('Not found') },
      },
    },
    '/admin/announcements': {
      get: { tags: ['Admin'], summary: 'All announcements, including unpublished', security: bearer, responses: { 200: json({ type: 'array', items: { type: 'object' } }) } },
      post: { tags: ['Admin'], summary: 'Add an announcement', security: bearer, requestBody: body('Announcement'), responses: { 201: json({ type: 'object' }, 'Created') } },
    },
    '/admin/announcements/{id}': {
      patch: { tags: ['Admin'], summary: 'Edit an announcement', security: bearer, parameters: [idParam], requestBody: body('Announcement'), responses: { 200: json({ type: 'object' }), 404: error('Not found') } },
      delete: { tags: ['Admin'], summary: 'Delete an announcement', security: bearer, parameters: [idParam], responses: { 204: { description: 'Deleted' }, 404: error('Not found') } },
    },
    '/admin/market': {
      patch: {
        tags: ['Admin'],
        summary: 'Edit branding and contact details, open or close applications',
        security: bearer,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: json({ type: 'object' }) },
      },
    },
    '/cron/retention': {
      get: {
        tags: ['System'],
        summary: 'Nightly retention job (called by Vercel with CRON_SECRET)',
        security: bearer,
        responses: { 200: json({ type: 'object' }), 401: error('Wrong or missing secret') },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from Supabase Auth' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'message'],
        properties: {
          error: { type: 'string', example: 'validation_failed' },
          message: { type: 'string', example: 'Some fields need attention.' },
          fields: { type: 'object', additionalProperties: { type: 'string' }, example: { postcode: 'Enter a valid UK postcode' } },
        },
      },
      Status: { enum: ['submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn'] },
      MarketDay: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          date: { type: 'string', format: 'date', example: '2026-12-05' },
          opens_at: { type: 'string', example: '10:00' },
          closes_at: { type: 'string', example: '20:00' },
        },
      },
      Market: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string', example: 'paisley' },
          name: { type: 'string' },
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          applications_open: { type: 'boolean' },
          primary_colour: { type: 'string', example: '#7a1f2b' },
          categories: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, label: { type: 'string' }, requires_food_registration: { type: 'boolean' } } } },
          stall_types: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, label: { type: 'string' }, fee_per_day_pence: { type: 'integer' } } } },
          market_days: { type: 'array', items: { $ref: '#/components/schemas/MarketDay' } },
        },
      },
      Trader: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          business_name: { type: 'string' },
          category: { type: 'string' },
          category_label: { type: 'string' },
          description: { type: 'string' },
          website_url: { type: ['string', 'null'] },
          social_link: { type: ['string', 'null'] },
          logo_url: { type: ['string', 'null'] },
          stalls: { type: 'array', items: { type: 'object', properties: { date: { type: 'string', format: 'date' }, stall: { type: 'string', example: 'C1' } } } },
        },
      },
      ApplicationForm: {
        type: 'object',
        required: [
          'business_name', 'contact_name', 'phone', 'postcode', 'category', 'description', 'stall_type',
          'needs_power', 'power_requirement', 'market_days', 'insurance_expiry', 'is_over_18', 'accept_privacy_policy',
        ],
        properties: {
          business_name: { type: 'string', minLength: 2, maxLength: 80, example: 'Gleniffer Candle Co.' },
          contact_name: { type: 'string', minLength: 2, maxLength: 80, example: 'Aisha Rahman' },
          phone: { type: 'string', example: '07700 900123' },
          postcode: { type: 'string', example: 'PA2 8AB' },
          category: { type: 'string', example: 'crafts_gifts' },
          description: { type: 'string', minLength: 20, maxLength: 500, example: 'Hand-poured soy candles and wax melts in winter scents, made in Paisley.' },
          stall_type: { type: 'string', example: 'gazebo_3x3' },
          needs_power: { type: 'boolean', example: false },
          power_requirement: { enum: ['none', 'one_socket', 'two_plus_sockets', 'high_load'], example: 'none' },
          market_days: { type: 'array', minItems: 1, items: { type: 'string', format: 'date' }, example: ['2026-12-05', '2026-12-06'] },
          insurance_expiry: { type: 'string', format: 'date', example: '2027-03-31' },
          website_url: { type: 'string', example: 'https://example.com' },
          social_link: { type: 'string', example: 'https://instagram.com/example' },
          additional_requirements: { type: 'string', maxLength: 300 },
          food_registration: { type: 'string', description: 'Storage path of the uploaded file. Required for food categories.' },
          uses_lpg: { type: 'boolean', example: false },
          gas_safety_certificate: { type: 'string', description: 'Storage path. Required when uses_lpg is true.' },
          logo: { type: 'string', description: 'Storage path of the uploaded logo.' },
          is_over_18: { const: true },
          accept_privacy_policy: { const: true },
          marketing_opt_in: { type: 'boolean', default: false },
        },
      },
      ApplicationReceipt: {
        type: 'object',
        properties: { id: { type: 'integer', example: 42 }, status: { $ref: '#/components/schemas/Status' }, submitted_at: { type: 'string', format: 'date-time' } },
      },
      Application: {
        type: 'object',
        description: 'The form fields plus status, admin_note, timestamps, market_days and allocations.',
        properties: {
          id: { type: 'integer' },
          status: { $ref: '#/components/schemas/Status' },
          admin_note: { type: ['string', 'null'] },
          business_name: { type: 'string' },
          market_days: { type: 'array', items: { type: 'string', format: 'date' } },
          allocations: { type: 'array', items: { type: 'object', properties: { date: { type: 'string', format: 'date' }, stall: { type: 'string' } } } },
        },
      },
      StatusChange: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { enum: ['under_review', 'approved', 'rejected', 'changes_requested'] },
          admin_note: { type: 'string', maxLength: 1000, example: 'Please upload a current insurance certificate.' },
        },
      },
      Allocation: {
        type: 'object',
        required: ['application_id', 'stall_id', 'market_day_id'],
        properties: { application_id: { type: 'integer' }, stall_id: { type: 'integer' }, market_day_id: { type: 'integer' } },
      },
      Enquiry: {
        type: 'object',
        required: ['message'],
        properties: {
          type: { enum: ['general', 'feedback', 'data_protection'], default: 'general' },
          message: { type: 'string', minLength: 10, maxLength: 2000 },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
      Profile: {
        type: 'object',
        required: ['contact_name', 'phone'],
        properties: { contact_name: { type: 'string' }, phone: { type: 'string' } },
      },
      Announcement: {
        type: 'object',
        required: ['title', 'body'],
        properties: { title: { type: 'string' }, body: { type: 'string' }, published: { type: 'boolean', default: true } },
      },
    },
  },
} as const;

/** A small page that renders the description above with Swagger UI. */
export const docsPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Market Platform API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="docs"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#docs', persistAuthorization: true });
  </script>
</body>
</html>`;
