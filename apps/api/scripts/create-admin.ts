// Cria (ou redefine a senha de) um super admin. A senha vem da variável ADMIN_PASSWORD, nunca de argumento (não fica no histórico).
//   ADMIN_PASSWORD='...' PLATFORM_DATABASE_URL=... npm run create-admin -w @pediu/api -- voce@empresa.com "Seu Nome"
import postgres from 'postgres';
import { hashPassword } from '@pediu/shared';

const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
const url = process.env.PLATFORM_DATABASE_URL;
if (!email || !name || !password || !url) { console.error('Uso: ADMIN_PASSWORD=... PLATFORM_DATABASE_URL=... create-admin <email> <nome>'); process.exit(1); }
if (password.length < 12) { console.error('Use uma senha com pelo menos 12 caracteres.'); process.exit(1); }

const sql = postgres(url, { max: 1, prepare: false });
const hash = await hashPassword(password);
await sql`
  insert into platform_admins (email, name, password_hash) values (${email.toLowerCase()}, ${name}, ${hash})
  on conflict (email) do update set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null`;
console.log(`Super admin ${email} pronto. No primeiro login você vai cadastrar o autenticador.`);
await sql.end();
