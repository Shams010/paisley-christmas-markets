import { serviceClient } from '../src/supabase.js';

const [email, slug = 'paisley', password] = process.argv.slice(2);

if (!email) {
  console.error('Usage: npm run create-admin -- <email> [market-slug] [password]');
  process.exit(1);
}

const service = serviceClient();

const market = await service.from('markets').select('id, name').eq('slug', slug).limit(1);
if (market.error || !market.data?.[0]) {
  console.error(`No market with the slug "${slug}". Has supabase/seed.sql been run?`);
  process.exit(1);
}
const { id: marketId, name: marketName } = market.data[0] as { id: string; name: string };

async function findUser(address: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === address.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

let user = await findUser(email);

if (!user) {
  if (!password) {
    console.error(`No account for ${email}. Sign up on the site first, or pass a password to create one now.`);
    process.exit(1);
  }
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    console.error(`Could not create ${email}: ${created.error?.message}`);
    process.exit(1);
  }
  user = created.data.user;
  console.log(`Created account ${email}`);
}

const updated = await service.auth.admin.updateUserById(user.id, {
  app_metadata: { role: 'admin', market_id: marketId },
});
if (updated.error) {
  console.error(`Could not update ${email}: ${updated.error.message}`);
  process.exit(1);
}

console.log(`${email} is now an administrator of ${marketName}.`);
console.log('They must log out and log in again for the change to take effect.');
