-- Lançamento incerto ("não tenho certeza deste lançamento").
--
-- Receitas e despesas únicas ainda pendentes podem ser marcadas como incertas.
-- O Fluxo de caixa (app e site) ganha o filtro "Considerar incertos" para
-- ver a projeção só com o que é garantido, e o Histórico mostra a etiqueta e
-- um filtro. O resto do FinFlow (Início, relatório, Finn) trata o incerto
-- como qualquer pendente.
--
--   * public.transacoes.incerta: falso por padrão; quem pode editar o
--     lançamento pode marcar ou desmarcar (mesmas regras de acesso da tabela).
--   * private.finflow_normalizar_incerta: a marcação só vale em receita ou
--     despesa pendente, com categoria, sem parcela, fixa, transferência,
--     objetivo ou fatura. Fora disso (inclusive ao concluir), volta a falso.
--
-- Reverter: drop trigger finflow_normalizar_incerta on public.transacoes;
--   drop function private.finflow_normalizar_incerta();
--   alter table public.transacoes drop column incerta.

ALTER TABLE "public"."transacoes" ADD COLUMN IF NOT EXISTS "incerta" boolean DEFAULT false NOT NULL;

CREATE OR REPLACE FUNCTION "private"."finflow_normalizar_incerta"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.incerta and (
    new.status is distinct from 'pendente'
    or new.tipo not in ('receita', 'despesa')
    or new.categoria_id is null
    or new.transacao_pai_id is not null
    or coalesce(new.descricao, '') ~ '\[(Serie:|Transf\.\]|Destino:|Objetivo:|PagFatura:)'
    or coalesce(new.descricao, '') ~ '\((Fixa|[0-9]+/[0-9]+)'
  ) then
    new.incerta := false;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "private"."finflow_normalizar_incerta"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."finflow_normalizar_incerta"() FROM PUBLIC;

CREATE OR REPLACE TRIGGER "finflow_normalizar_incerta" BEFORE INSERT OR UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_normalizar_incerta"();
