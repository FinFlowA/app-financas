-- FinFlow: endurecimento do RLS do núcleo financeiro e das parcerias.
-- Não altera dados financeiros nem ativa planos, pagamentos ou IA.

begin;

-- Identificadores de propriedade e do convite não podem ser trocados em updates.
create or replace function public.preserve_finflow_row_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'parcerias' then
    if new.id is distinct from old.id
       or new.solicitante_id is distinct from old.solicitante_id
       or lower(new.convidado_email) is distinct from lower(old.convidado_email) then
      raise exception using errcode = '42501', message = 'partnership identity cannot be changed';
    end if;
  elsif new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'resource owner cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_finflow_row_identity() from public, anon, authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'contas', 'caixinhas', 'categorias', 'transacoes', 'cartoes',
    'fatura_itens', 'chat_historico', 'feedbacks'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format(
        'drop trigger if exists preserve_finflow_row_identity_before_update on public.%I',
        target_table
      );
      execute format(
        'create trigger preserve_finflow_row_identity_before_update
         before update on public.%I
         for each row execute function public.preserve_finflow_row_identity()',
        target_table
      );
    end if;
  end loop;

  if to_regclass('public.parcerias') is not null then
    drop trigger if exists preserve_finflow_partnership_identity_before_update
      on public.parcerias;
    create trigger preserve_finflow_partnership_identity_before_update
      before update on public.parcerias
      for each row execute function public.preserve_finflow_row_identity();
  end if;
end;
$$;

-- Função usada pelo RLS: somente confirma parceria do próprio chamador.
create or replace function public.is_parceiro(dono uuid, visitante uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and visitante = (select auth.uid())
    and exists (
      select 1
      from public.parcerias p
      where p.status = 'aceito'
        and (
          (p.solicitante_id = dono and p.convidado_id = visitante)
          or
          (p.solicitante_id = visitante and p.convidado_id = dono)
        )
    );
$$;

revoke all on function public.is_parceiro(uuid, uuid) from public, anon;
grant execute on function public.is_parceiro(uuid, uuid) to authenticated;

-- Nome só pode ser consultado pelo próprio usuário ou por parceiro aceito.
-- O e-mail deixa de ser usado como fallback para evitar exposição desnecessária.
create or replace function public.get_user_name(user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    u.raw_user_meta_data ->> 'nome_usuario',
    u.raw_user_meta_data ->> 'full_name',
    'Parceiro(a)'
  )
  from auth.users u
  where u.id = user_id
    and (
      u.id = (select auth.uid())
      or public.is_parceiro(u.id, (select auth.uid()))
    );
$$;

revoke all on function public.get_user_name(uuid) from public, anon;
grant execute on function public.get_user_name(uuid) to authenticated;

-- Função de trigger não deve ser invocável diretamente pela API.
alter function public.criar_categorias_padrao() set search_path = '';
revoke all on function public.criar_categorias_padrao() from public, anon, authenticated;

-- Nenhuma tabela do núcleo financeiro deve aceitar operações anônimas.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'contas', 'caixinhas', 'categorias', 'transacoes', 'cartoes',
    'fatura_itens', 'chat_historico', 'feedbacks', 'parcerias'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('revoke all on table public.%I from anon', target_table);
      execute format(
        'grant select, insert, update, delete on table public.%I to authenticated',
        target_table
      );
    end if;
  end loop;
end;
$$;

-- Categorias: somente o proprietário.
drop policy if exists "Acesso as próprias categorias" on public.categorias;
drop policy if exists "categorias_proprio_usuario" on public.categorias;
create policy "categorias_owner_all"
  on public.categorias for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Histórico de IA: somente o proprietário.
drop policy if exists "Usuário vê só o próprio histórico" on public.chat_historico;
create policy "chat_historico_owner_all"
  on public.chat_historico for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Cartões e itens: somente o proprietário; item deve apontar para cartão próprio.
drop policy if exists "cartoes_user_own" on public.cartoes;
create policy "cartoes_owner_all"
  on public.cartoes for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "fatura_itens_user_own" on public.fatura_itens;
create policy "fatura_itens_owner_all"
  on public.fatura_itens for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cartoes c
      where c.id = cartao_id and c.user_id = (select auth.uid())
    )
  );

-- Feedback: remove duplicatas; usuário insere e lê apenas o próprio.
drop policy if exists "Usuário pode inserir feedback" on public.feedbacks;
drop policy if exists "feedbacks_inserir" on public.feedbacks;
drop policy if exists "usuario pode inserir feedback" on public.feedbacks;
drop policy if exists "Usuário pode ver seus feedbacks" on public.feedbacks;
create policy "feedbacks_owner_select"
  on public.feedbacks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "feedbacks_owner_insert"
  on public.feedbacks for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Parcerias: convite nasce pendente e só o e-mail convidado pode aceitá-lo.
drop policy if exists "insert_parcerias" on public.parcerias;
drop policy if exists "select_parcerias" on public.parcerias;
drop policy if exists "update_parcerias" on public.parcerias;
drop policy if exists "delete_parcerias" on public.parcerias;

create policy "parcerias_participant_select"
  on public.parcerias for select to authenticated
  using (
    (select auth.uid()) = solicitante_id
    or (select auth.uid()) = convidado_id
    or lower((select auth.jwt() ->> 'email')) = lower(convidado_email)
  );

create policy "parcerias_requester_insert"
  on public.parcerias for insert to authenticated
  with check (
    (select auth.uid()) = solicitante_id
    and convidado_id is null
    and status = 'pendente'
    and lower(convidado_email) <> lower((select auth.jwt() ->> 'email'))
  );

create policy "parcerias_invitee_accept"
  on public.parcerias for update to authenticated
  using (
    status = 'pendente'
    and convidado_id is null
    and lower((select auth.jwt() ->> 'email')) = lower(convidado_email)
  )
  with check (
    status = 'aceito'
    and convidado_id = (select auth.uid())
    and solicitante_id <> (select auth.uid())
    and lower((select auth.jwt() ->> 'email')) = lower(convidado_email)
  );

create policy "parcerias_participant_delete"
  on public.parcerias for delete to authenticated
  using (
    (select auth.uid()) = solicitante_id
    or (select auth.uid()) = convidado_id
    or lower((select auth.jwt() ->> 'email')) = lower(convidado_email)
  );

-- Contas: dono administra; parceiro aceito apenas visualiza conta compartilhada.
drop policy if exists "Contas privadas e conjuntas" on public.contas;
drop policy if exists "contas_proprio_usuario" on public.contas;
drop policy if exists "select_contas" on public.contas;

create policy "contas_owner_all"
  on public.contas for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "contas_partner_select"
  on public.contas for select to authenticated
  using (
    compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  );

-- Objetivos: dono administra; parceiro aceito visualiza e atualiza objetivo
-- compartilhado, mas não pode trocar o dono, apagar ou criar em nome dele.
drop policy if exists "Caixinhas privadas e conjuntas" on public.caixinhas;
drop policy if exists "caixinhas_proprio_usuario" on public.caixinhas;
drop policy if exists "select_caixinhas" on public.caixinhas;

create policy "caixinhas_owner_all"
  on public.caixinhas for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "caixinhas_partner_select"
  on public.caixinhas for select to authenticated
  using (
    compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  );

create policy "caixinhas_partner_update"
  on public.caixinhas for update to authenticated
  using (
    compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  )
  with check (
    compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  );

-- Transações: dono administra. Em conta compartilhada, ambos podem visualizar
-- e operar, mas o user_id original é imutável pelo trigger acima.
drop policy if exists "Transacoes de contas conjuntas" on public.transacoes;
drop policy if exists "Usuário acessa próprias transacoes" on public.transacoes;
drop policy if exists "transacoes_proprio_usuario" on public.transacoes;
drop policy if exists "select_transacoes" on public.transacoes;

create policy "transacoes_accessible_select"
  on public.transacoes for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.contas c
      where c.id = conta_id
        and c.compartilhado is true
        and public.is_parceiro(c.user_id, (select auth.uid()))
    )
  );

create policy "transacoes_accessible_insert"
  on public.transacoes for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.contas c
      where c.id = conta_id
        and (
          c.user_id = (select auth.uid())
          or (
            c.compartilhado is true
            and public.is_parceiro(c.user_id, (select auth.uid()))
          )
        )
    )
  );

create policy "transacoes_accessible_update"
  on public.transacoes for update to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.contas c
      where c.id = conta_id
        and c.compartilhado is true
        and public.is_parceiro(c.user_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.contas c
      where c.id = conta_id
        and (
          c.user_id = (select auth.uid())
          or (
            c.compartilhado is true
            and public.is_parceiro(c.user_id, (select auth.uid()))
          )
        )
    )
  );

create policy "transacoes_accessible_delete"
  on public.transacoes for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.contas c
      where c.id = conta_id
        and c.compartilhado is true
        and public.is_parceiro(c.user_id, (select auth.uid()))
    )
  );

commit;
