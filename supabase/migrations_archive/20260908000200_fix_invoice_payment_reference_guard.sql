-- O pagamento parcial cria um item técnico com categoria nula. O validador de
-- referências aceitava o saldo levado adiante, mas rejeitava esse outro formato
-- produzido pelo mesmo executor seguro, fazendo o pagamento inteiro retroceder.
begin;

create or replace function private.finflow_validate_financial_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker text[];
  referenced_id bigint;
  operation text;
begin
  if tg_table_name = 'transacoes' then
    if new.user_id is null or new.conta_id is null then
      raise exception using errcode='23514',message='FINFLOW_TRANSACTION_OWNER_ACCOUNT_REQUIRED';
    end if;
    if not exists (
      select 1 from public.contas account_row where account_row.id=new.conta_id and (
        account_row.user_id=new.user_id or (account_row.compartilhado is true and exists (
          select 1 from public.parcerias partnership_row where partnership_row.status='aceito' and (
            (partnership_row.solicitante_id=account_row.user_id and partnership_row.convidado_id=new.user_id)
            or (partnership_row.convidado_id=account_row.user_id and partnership_row.solicitante_id=new.user_id)
          )
        ))
      )
    ) then raise exception using errcode='23514',message='FINFLOW_TRANSACTION_ACCOUNT_INVALID'; end if;
    if new.categoria_id is not null then
      if not exists (select 1 from public.categorias category_row where category_row.id=new.categoria_id
        and category_row.user_id=new.user_id and category_row.tipo in (new.tipo,'ambos')) then
        raise exception using errcode='23514',message='FINFLOW_TRANSACTION_CATEGORY_INVALID';
      end if;
      return new;
    end if;
    marker:=regexp_match(coalesce(new.descricao,''),'\[Destino:([0-9]+)\]');
    if marker is not null then
      referenced_id:=marker[1]::bigint;
      if new.tipo<>'despesa' or not exists(select 1 from public.contas c where c.id=referenced_id and (
        c.user_id=new.user_id or (c.compartilhado is true and exists (
          select 1 from public.parcerias p where p.status='aceito' and (
            (p.solicitante_id=c.user_id and p.convidado_id=new.user_id)
            or (p.convidado_id=c.user_id and p.solicitante_id=new.user_id)
          )
        ))
      ))
      then raise exception using errcode='23514',message='FINFLOW_TRANSFER_DESTINATION_INVALID'; end if;
      return new;
    end if;
    marker:=regexp_match(coalesce(new.descricao,''),'\[Objetivo:([0-9]+):(guardar|resgatar)\]\s*$');
    if marker is not null then
      referenced_id:=marker[1]::bigint; operation:=marker[2];
      if (operation='guardar' and new.tipo<>'despesa') or (operation='resgatar' and new.tipo<>'receita')
        or not exists(select 1 from public.caixinhas g where g.id=referenced_id and (
          g.user_id=new.user_id or (g.compartilhado is true and exists (
            select 1 from public.parcerias p where p.status='aceito' and (
              (p.solicitante_id=g.user_id and p.convidado_id=new.user_id)
              or (p.convidado_id=g.user_id and p.solicitante_id=new.user_id)
            )
          ))
        ))
      then raise exception using errcode='23514',message='FINFLOW_GOAL_REFERENCE_INVALID'; end if;
      return new;
    end if;
    marker:=regexp_match(coalesce(new.descricao,''),'\[PagFatura:([0-9]+):[0-9]{4}-(0[1-9]|1[0-2]):(total|parcial|saldo_transferido)(:[0-9]+)?\]\s*$');
    if marker is not null then
      referenced_id:=marker[1]::bigint;
      if new.tipo<>'despesa' or not exists(select 1 from public.cartoes c where c.id=referenced_id and c.user_id=new.user_id)
      then raise exception using errcode='23514',message='FINFLOW_INVOICE_PAYMENT_REFERENCE_INVALID'; end if;
      return new;
    end if;
    raise exception using errcode='23514',message='FINFLOW_TRANSACTION_CATEGORY_REQUIRED';
  end if;

  if tg_table_name = 'fatura_itens' then
    if new.user_id is null or new.cartao_id is null or not exists (
      select 1 from public.cartoes c where c.id=new.cartao_id and c.user_id=new.user_id
    ) then raise exception using errcode='23514',message='FINFLOW_INVOICE_CARD_INVALID'; end if;
    if new.categoria_id is not null then
      if not exists(select 1 from public.categorias c where c.id=new.categoria_id
        and c.user_id=new.user_id and c.tipo in ('despesa','ambos'))
      then raise exception using errcode='23514',message='FINFLOW_INVOICE_CATEGORY_INVALID'; end if;
      return new;
    end if;
    if coalesce(new.descricao,'') <> 'Pagamento parcial da fatura'
       and coalesce(new.descricao,'') !~ '^Saldo da fatura anterior( \([0-9]{4}-(0[1-9]|1[0-2])\))?$' then
      raise exception using errcode='23514',message='FINFLOW_INVOICE_CATEGORY_REQUIRED';
    end if;
    return new;
  end if;
  raise exception using errcode='42P01',message='FINFLOW_UNSUPPORTED_FINANCIAL_TABLE';
end;
$$;

revoke all on function private.finflow_validate_financial_references() from public,anon,authenticated;

commit;
