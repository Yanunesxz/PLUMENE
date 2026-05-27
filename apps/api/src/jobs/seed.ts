import 'dotenv/config';
import { createHash } from 'crypto';
import { supabase } from '../config/supabase.js';

function hash(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

async function seed() {
  console.log('🌱 Iniciando seed...');

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert({ name: 'Corpo Sensual Ltda' })
    .select()
    .single();

  if (companyError || !company) {
    console.error('Erro ao criar empresa:', companyError?.message);
    process.exit(1);
  }
  const company_id = (company as { id: string }).id;
  console.log(`✅ Empresa criada: ${company_id}`);

  const { data: tables } = await supabase
    .from('price_tables')
    .insert([
      { company_id, name: 'Tabela A — Varejo' },
      { company_id, name: 'Tabela B — Atacado' },
      { company_id, name: 'Tabela C — VIP' },
    ])
    .select();

  const [tableA, tableB, tableC] = (tables ?? []) as Array<{ id: string; name: string }>;
  console.log(`✅ 3 tabelas de preço criadas`);

  const { data: users } = await supabase
    .from('users')
    .insert([
      {
        company_id,
        name: 'Admin Sistema',
        email: 'admin@csb.com',
        password_hash: hash('admin123'),
        role: 'admin',
      },
      {
        company_id,
        name: 'Gerente Comercial',
        email: 'gerente@csb.com',
        password_hash: hash('gerente123'),
        role: 'manager',
      },
      {
        company_id,
        name: 'João Representante',
        email: 'joao@csb.com',
        password_hash: hash('rep123'),
        role: 'rep',
      },
    ])
    .select();
  console.log(`✅ ${(users ?? []).length} usuários criados`);

  const productInserts = [
    { company_id, sku: 'PJ001', name: 'Pijama Seda Rose', description: 'Conjunto calça e blusa em cetim', active: true },
    { company_id, sku: 'PJ002', name: 'Pijama Viscose Floral', description: 'Estampa floral verão', active: true },
    { company_id, sku: 'PJ003', name: 'Camisola Renda Branca', description: 'Renda na barra e decote', active: true },
    { company_id, sku: 'PJ004', name: 'Pijama Short Doll', description: 'Conjunto short e regata', active: true },
    { company_id, sku: 'PJ005', name: 'Roupão Microfibra', description: 'Microfibra macia, cinto incluso', active: true },
  ];

  const { data: products } = await supabase
    .from('products')
    .insert(productInserts)
    .select();
  console.log(`✅ ${(products ?? []).length} produtos criados`);

  if (products && tableA && tableB && tableC) {
    const prices = (products as Array<{ id: string }>).flatMap((p, i) => [
      { product_id: p.id, price_table_id: tableA.id, price: 89.9 + i * 10 },
      { product_id: p.id, price_table_id: tableB.id, price: 79.9 + i * 10 },
      { product_id: p.id, price_table_id: tableC.id, price: 69.9 + i * 10 },
    ]);
    await supabase.from('product_prices').insert(prices);
    console.log(`✅ ${prices.length} preços inseridos`);
  }

  const customerInserts = Array.from({ length: 10 }, (_, i) => ({
    company_id,
    name: `Loja ${String(i + 1).padStart(2, '0')} — ${['SP', 'RJ', 'MG', 'RS', 'PR', 'BA', 'SC', 'GO', 'PE', 'CE'][i]}`,
    cnpj: `${String(i + 1).padStart(2, '0')}.000.000/0001-${String(i + 1).padStart(2, '0')}`,
    price_table_id: [tableA, tableB, tableC][i % 3]?.id ?? tableA?.id,
    blocked: i === 9,
    block_reason: i === 9 ? 'Inadimplência — aguardando regularização' : null,
  }));

  await supabase.from('customers').insert(customerInserts);
  console.log(`✅ 10 clientes criados (1 bloqueado)`);

  console.log('\n🎉 Seed concluído!\n');
  console.log('Credenciais de acesso:');
  console.log('  admin@csb.com    / admin123   (admin)');
  console.log('  gerente@csb.com  / gerente123 (manager)');
  console.log('  joao@csb.com     / rep123     (rep)');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
