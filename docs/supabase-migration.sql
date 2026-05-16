-- FinFlow — Migração Supabase
-- Execute este SQL no painel do Supabase (SQL Editor)
-- Pode ser executado múltiplas vezes com segurança (IF NOT EXISTS / IF EXISTS)

-- ─── Tabela de Cartões de Crédito ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cartoes (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome VARCHAR(100) NOT NULL,
  cor VARCHAR(20) NOT NULL DEFAULT '#457B9D',
  limite DECIMAL(12,2) NOT NULL DEFAULT 0,
  dia_vencimento INTEGER NOT NULL DEFAULT 10,
  dia_fechamento INTEGER NOT NULL DEFAULT 3,
  ativo BOOLEAN NOT NULL DEFAULT true,
  bloqueado_plano BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Coluna bloqueado_plano nos cartões (para quem já criou a tabela)
ALTER TABLE cartoes ADD COLUMN IF NOT EXISTS bloqueado_plano BOOLEAN NOT NULL DEFAULT false;

-- ─── Tabela de Itens da Fatura ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fatura_itens (
  id SERIAL PRIMARY KEY,
  cartao_id INTEGER NOT NULL REFERENCES cartoes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  descricao VARCHAR(200) NOT NULL,
  valor DECIMAL(12,2) NOT NULL,
  data_compra DATE NOT NULL,
  mes_fatura VARCHAR(7) NOT NULL,       -- formato YYYY-MM
  parcela_atual INTEGER NOT NULL DEFAULT 1,
  total_parcelas INTEGER NOT NULL DEFAULT 1,
  grupo_parcela_id INTEGER REFERENCES fatura_itens(id) ON DELETE SET NULL,
  categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  pago BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Coluna categoria_id nos itens de fatura (para quem já criou a tabela)
ALTER TABLE fatura_itens ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL;

-- ─── Coluna bloqueado_plano nas contas ───────────────────────────────────────
-- Permite que itens bloqueados por downgrade continuem visíveis (com cadeado)
-- sem serem arquivados

ALTER TABLE contas ADD COLUMN IF NOT EXISTS bloqueado_plano BOOLEAN NOT NULL DEFAULT false;

-- ─── Coluna bloqueado_plano nas caixinhas ────────────────────────────────────

ALTER TABLE caixinhas ADD COLUMN IF NOT EXISTS bloqueado_plano BOOLEAN NOT NULL DEFAULT false;

-- ─── Coluna bloqueado_plano nas categorias ───────────────────────────────────

ALTER TABLE categorias ADD COLUMN IF NOT EXISTS bloqueado_plano BOOLEAN NOT NULL DEFAULT false;

-- ─── Índices para performance ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cartoes_user_id ON cartoes(user_id);
CREATE INDEX IF NOT EXISTS idx_fatura_itens_user_id ON fatura_itens(user_id);
CREATE INDEX IF NOT EXISTS idx_fatura_itens_cartao_mes ON fatura_itens(cartao_id, mes_fatura);
CREATE INDEX IF NOT EXISTS idx_fatura_itens_grupo ON fatura_itens(grupo_parcela_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE cartoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fatura_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cartoes_user_own" ON cartoes;
CREATE POLICY "cartoes_user_own" ON cartoes
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "fatura_itens_user_own" ON fatura_itens;
CREATE POLICY "fatura_itens_user_own" ON fatura_itens
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Função para exclusão de conta ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
