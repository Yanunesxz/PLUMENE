import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase.js';

// Cria 5 representantes para apresentação. Idempotente: e-mail já existente é pulado.
// Cada rep recebe uma tabela de preço — sem ela não conseguiria criar pedido
// (o servidor recalcula o preço pela tabela do representante).

const PASSWORD = 'Rep123*';
const COMMISSION_RATE = 10; // %

const reps = [
  { email: 'representante1@csb.com', name: 'Representante 1' },
  { email: 'representante2@csb.com', name: 'Representante 2' },
  { email: 'representante3@csb.com', name: 'Representante 3' },
  { email: 'representante4@csb.com', name: 'Representante 4' },
  { email: 'representante5@csb.com', name: 'Representante 5' },
];

async function run() {
  // company_id da empresa ativa: pega de um usuário admin/manager existente.
  const { data: ref } = await supabase
    .from('users')
    .select('company_id')
    .in('role', ['admin', 'manager'])
    .limit(1)
    .maybeSingle();

  const company_id = (ref as { company_id: string } | null)?.company_id;
  if (!company_id) {
    console.error('❌ Não encontrei empresa (nenhum admin/manager). Rode o seed primeiro.');
    process.exit(1);
  }

  // Uma tabela de preço dessa empresa para atribuir aos reps.
  const { data: table } = await supabase
    .from('price_tables')
    .select('id, name')
    .eq('company_id', company_id)
    .order('name')
    .limit(1)
    .maybeSingle();

  const price_table_id = (table as { id: string; name: string } | null)?.id ?? null;
  console.log(`🏢 Empresa: ${company_id}`);
  console.log(`💲 Tabela de preço: ${(table as { name?: string } | null)?.name ?? '(nenhuma)'}`);

  const password_hash = bcrypt.hashSync(PASSWORD, 10);

  for (const r of reps) {
    const email = r.email.trim().toLowerCase();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      console.log(`⏭️  ${email} já existe — pulado`);
      continue;
    }

    const { error } = await supabase.from('users').insert({
      company_id,
      name: r.name,
      email,
      password_hash,
      role: 'rep',
      active: true,
      price_table_id,
      commission_rate: COMMISSION_RATE,
    });

    if (error) console.error(`❌ ${email}: ${error.message}`);
    else console.log(`✅ ${email} criado (senha: ${PASSWORD})`);
  }

  console.log('\n🎉 Concluído.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
