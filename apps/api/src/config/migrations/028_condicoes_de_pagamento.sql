-- ─────────────────────────────────────────────────────────────────────────────
-- Migração 028 — Condições de pagamento do Control
-- Executar no Supabase SQL Editor. Idempotente.
--
-- O Control fecha o pedido com uma condição de pagamento (COND PGTO no
-- formulário oficial), mas o sistema não tinha onde guardá-la: o campo saía em
-- branco na planilha e a fábrica preenchia à mão. Agora o representante — e a
-- própria loja, quando compra pelo login dela — escolhe a condição no pedido.
--
-- As 146 condições vieram da exportação do Control (Pasta1.xlsx, 13/08/2026).
-- O CÓDIGO é a identidade, não o texto: há descrições repetidas com códigos
-- diferentes de propósito ("60 DIAS" é o 15 e o 36; "A VISTA" é o 1 e o 68) —
-- no Control são condições distintas, com prazos e regras próprias.
--
-- O INSERT é ON CONFLICT DO UPDATE: rodar de novo com uma lista mais nova
-- atualiza as descrições sem duplicar nem apagar. Condição que sair do Control
-- é desativada à mão (active = false), nunca deletada — pedido antigo aponta
-- para ela.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_conditions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- O código da condição NO CONTROL (1 a 146 hoje). É ele que identifica.
  code        INTEGER NOT NULL,
  description TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_payment_conditions_company
  ON payment_conditions(company_id) WHERE active;

ALTER TABLE payment_conditions ENABLE ROW LEVEL SECURITY;

-- A condição escolhida fica NO PEDIDO. NULL nos anteriores à migração — e nos
-- que ninguém escolheu: aí a planilha sai com COND PGTO em branco, como sempre
-- saiu, e a fábrica preenche.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_condition_id UUID REFERENCES payment_conditions(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.payment_condition_id IS
  'Condição de pagamento escolhida no pedido (rep ou loja). NULL = ninguém escolheu; a planilha sai em branco.';

-- As 146 condições, para TODAS as empresas (hoje há uma). Gerado da Pasta1.xlsx
-- em 13/08/2026 — não editar à mão: qualquer atualização vem de nova exportação.
INSERT INTO payment_conditions (company_id, code, description)
SELECT c.id, v.code, v.description
  FROM companies c
 CROSS JOIN (VALUES
  (1, 'A VISTA'),
  (2, '30 DIAS'),
  (3, '30/60 DIAS'),
  (4, '30/60/90 DIAS'),
  (5, '30/60/90/120 DIAS'),
  (6, '30/60/90/120/150'),
  (7, '60/90/120'),
  (8, '30/45/60/75/90'),
  (9, '30/45/60/75/90'),
  (10, '30/45/60/75/90/105'),
  (11, '20'),
  (12, '15'),
  (13, '45/75/105/135'),
  (14, '60/90/120/150'),
  (15, '60 DIAS'),
  (16, '30/45/60/75/90/105/120'),
  (17, '45/75/105'),
  (18, '45/75'),
  (19, '20/40'),
  (20, '54/84/114/144'),
  (21, '60/90/120/150/180'),
  (22, '28 DIAS'),
  (23, '44/74/104/134/164 DIAS'),
  (24, 'CHEQUE'),
  (25, '43/73/103/133/163 DIAS'),
  (26, '44/74/104/134 DIAS'),
  (27, '44/74'),
  (28, '10 DIAS'),
  (29, '45/60/75/90/105/120/135/150'),
  (30, '15/45/75'),
  (31, '45'),
  (32, '50/80/110/140'),
  (33, '30/60/90/120/150/180 DIAS'),
  (34, '90/120 DIAS'),
  (35, '45/75/105/135/165'),
  (36, '60 DIAS'),
  (37, '40/70/100/130/160 DIAS'),
  (38, 'DEPOSITO'),
  (39, '30/45/60/75/90/105/120/135 DIAS'),
  (40, '15/30'),
  (41, '40 DIAS'),
  (42, '15/45/75/105'),
  (43, '30/45/60/75/90/105/120/135/150'),
  (44, '30/45/60/75/90/105/120/135/150/165 DIAS'),
  (45, '30/45/60'),
  (46, '50/80/110'),
  (47, '20/30'),
  (48, '30/45/60/75/90/105/120/135/150/165/180'),
  (49, '30/50/70/90/110/130'),
  (50, '20/30/40'),
  (51, '30/60/45/90'),
  (52, '30/60/75/90'),
  (53, '45/60/75/90/105/120/135/150/165/180'),
  (54, '44/74/104'),
  (55, '15/15'),
  (56, '30/45/60/75/90/105/120/135/150/165/180/195'),
  (57, '30/60/90/120/150/180/210'),
  (58, '30/50/70/90/110/130/150'),
  (59, '28/35/42/49/56/63/70/77'),
  (60, '30/45/60/75/90/105/120/135/150/165/180/195/210'),
  (61, '15/30/45'),
  (62, '7/14 DIAS'),
  (63, '30/60/90/120/150/180/210/240'),
  (64, '60/90'),
  (65, '15/25'),
  (66, '50/80/110/140/170'),
  (67, '60/75/90/105/120'),
  (68, 'A VISTA'),
  (69, '10/20 DIAS'),
  (70, '15/30/45/60/75/90'),
  (71, '30/45/60/75'),
  (72, '10/10 DIAS'),
  (73, '30/50/70/90 DIAS'),
  (74, '20/20'),
  (75, '30/30 DIAS'),
  (76, '40/70/100/130'),
  (77, '30/45 DIAS'),
  (78, '10/20/30 DIAS'),
  (79, '45/45 DIAS'),
  (80, '1 DIA'),
  (81, '30/50/70'),
  (82, '90/120/150 DIAS'),
  (83, '15/30/45/60/75/90/105/120'),
  (84, '15/30/45/60/75 DIAS'),
  (85, '30/60/75/90/120 DIAS'),
  (86, '15/30/45/60/75/90/105/120/135/150 DIAS'),
  (87, '30/50/70/90/105/120 DIAS'),
  (88, '30/50'),
  (89, '45/60/75/90/105/120/135 DIAS'),
  (90, '45/60/75/90 DIAS'),
  (91, '30/40 DIAS'),
  (92, '60/90/120/150/180/210'),
  (93, '45/55/65/75/85/95/105 DIAS'),
  (94, '45/52/59/66/73/80/87/94/101/108/115/122/129/136'),
  (95, '15/30/45/60/75/90/105/120/135'),
  (96, '90/120/150/180'),
  (97, '10/20/30/40'),
  (98, '15/30/60/90/120'),
  (99, '90 DIAS'),
  (100, '15/45'),
  (101, '15/45/75/105/135'),
  (102, '75 DIAS'),
  (103, '30/37/44/51/58/65/72/79/86/93/100/107/114/121/128/135'),
  (104, '30/60/75/90/105/120'),
  (105, '30/50/70/90/110/120'),
  (106, '1/30/60/90/120/150'),
  (107, '60/61/62/90/91/92/120/121'),
  (108, '21 DIAS'),
  (109, '20/40/60'),
  (110, '60/75/90/105/120/150'),
  (111, '45/60/90/120/150'),
  (112, '45/60/75/90/105'),
  (113, '40/40'),
  (114, '60/61/62/63/64/90/91/92/93/94/120/121/122/123/124/150/151/152/153/154'),
  (115, '60/120'),
  (116, '75/105/135'),
  (117, '15/30/45/60'),
  (118, '35/65/95/125'),
  (119, '45/105/135 DIAS'),
  (120, '15/30/45/60/75/90/105'),
  (121, '30/45/60/75/90/120 DIAS'),
  (122, '30/45/60/75/90/120/135 DIAS'),
  (123, '30/50/70/90/110/130/150/170'),
  (124, '60/75/90/105/135/150 DIAS'),
  (125, '60/90/120/150/165/180'),
  (126, '30/90'),
  (127, '30/120'),
  (128, '25 DIAS'),
  (129, '45 DIAS'),
  (130, '45/105/135 DIAS'),
  (131, '30/120/150'),
  (132, '120/150/180 DIAS'),
  (133, '30/45/60/75/90/105'),
  (134, '60/90/120 DIAS'),
  (135, '30/45/60/75/90/105/120 DIAS'),
  (136, '45/75/105/135/165 DIAS'),
  (137, '30/45/60/75/90/105/120/135/150 DIAS'),
  (138, '30/45/60/75/90/105/120/135/150 DIAS'),
  (139, '60/90/120 DIAS'),
  (140, '45/75/105/135 DIAS'),
  (141, '60/90/120/150 DIAS'),
  (142, '30/45/60/75/90/105/120 DIAS'),
  (143, '30/45/60/75/90/105/120/135/150/165/180/195/210/225/240/255/270/285/300/315'),
  (144, '35 DIAS'),
  (145, '45/46/47/48/49/60/61/62/63/64/90/91/92/93/94/120/121/122/123/124/150/151/152/153/154'),
  (146, '45/60/90/120') ) AS v(code, description)
ON CONFLICT (company_id, code)
DO UPDATE SET description = EXCLUDED.description, updated_at = NOW();

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM payment_conditions;                    -- 146
-- SELECT code, description FROM payment_conditions ORDER BY code LIMIT 10;
