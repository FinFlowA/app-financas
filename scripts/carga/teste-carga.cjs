/* eslint-disable security/detect-non-literal-fs-filename */
// Teste de carga do FinFlow contra um projeto Supabase DE TESTE (nunca a produção).
//
//   node scripts/carga/teste-carga.cjs preparar <ref-do-projeto-de-teste> [usuarios=200]
//   node scripts/carga/teste-carga.cjs rodar <ref> [ondas=20,50,100,200] [segundos=60]
//   node scripts/carga/teste-carga.cjs limpar <ref>
//
// - As chaves do projeto vêm da Supabase CLI e ficam só na memória.
// - As contas de teste são fictícias (@example.com); e-mails e senhas ficam num
//   arquivo na pasta temporária do sistema (fora do repositório), apagado no "limpar".
// - Cada pessoa simulada repete: abre o Início (as mesmas consultas do app) e,
//   em metade das vezes, lança uma despesa pelo mesmo caminho do app
//   (execute_manual_financial_action); depois "pensa" 1–3 s. As ondas aumentam o
//   número de pessoas simultâneas, e cada onda mede tempo de resposta e erros.
const { execSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PRODUCAO = "qxnfpnabyytdbzdkklet";
const [comando, ref, arg1, arg2] = process.argv.slice(2);

if (!["preparar", "rodar", "limpar"].includes(comando) || !/^[a-z]{20}$/.test(ref ?? "")) {
  console.error("Uso: node scripts/carga/teste-carga.cjs <preparar|rodar|limpar> <ref-do-projeto-de-teste> [...]");
  process.exit(1);
}
if (ref === PRODUCAO) {
  console.error("Recusado: este é o projeto de PRODUÇÃO. O teste de carga só roda num projeto de teste.");
  process.exit(1);
}

const URL_BASE = `https://${ref}.supabase.co`;
const ARQUIVO_CONTAS = path.join(os.tmpdir(), `finflow-carga-${ref}.json`);
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hojeSP = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

function chaves() {
  const saida = execSync(`npx -y supabase@2.118.0 projects api-keys --project-ref ${ref} --output json`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lista = JSON.parse(saida.slice(saida.indexOf("[")));
  const achar = (...nomes) => lista.find((k) => nomes.includes(k.name) || nomes.includes(k.type))?.api_key;
  const publica = achar("anon", "publishable");
  const secreta = achar("service_role", "secret");
  if (!publica || !secreta) throw new Error("Não encontrei as chaves do projeto de teste.");
  return { publica, secreta };
}

async function http(metodo, rota, { chave, token, corpo, prefer } = {}) {
  const inicio = performance.now();
  const cabecalhos = { apikey: chave, "Content-Type": "application/json" };
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  else if (!chave.startsWith("sb_")) cabecalhos.Authorization = `Bearer ${chave}`;
  if (prefer) cabecalhos.Prefer = prefer;
  let status = 0;
  let json = null;
  try {
    const resposta = await fetch(URL_BASE + rota, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });
    status = resposta.status;
    const texto = await resposta.text();
    try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  } catch {
    status = 0; // tempo esgotado ou falha de rede
  }
  return { status, json, ms: performance.now() - inicio };
}

async function entrar(publica, conta) {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const r = await http("POST", "/auth/v1/token?grant_type=password", {
      chave: publica,
      corpo: { email: conta.email, password: conta.senha },
    });
    if (r.status === 200 && r.json?.access_token) return { token: r.json.access_token, userId: r.json.user.id };
    await espera(r.status === 429 ? 15_000 : 2_000);
  }
  throw new Error(`Não consegui entrar com ${conta.email}.`);
}

// ---------------------------------------------------------------- preparar
function lancamentosFicticios(userId, contas, categorias) {
  const despesas = categorias.filter((c) => c.tipo === "despesa");
  const receitas = categorias.filter((c) => c.tipo === "receita");
  const linhas = [];
  const hoje = new Date();
  // 300 lançamentos realizados nos últimos 12 meses.
  for (let i = 0; i < 300; i += 1) {
    const data = new Date(hoje.getTime() - Math.floor(Math.random() * 365) * 86400000).toISOString().slice(0, 10);
    const receita = i % 10 === 0;
    const categoria = receita ? receitas[i % receitas.length] : despesas[i % despesas.length];
    linhas.push({
      user_id: userId, tipo: receita ? "receita" : "despesa",
      valor: Math.round((receita ? 2500 + Math.random() * 3000 : 10 + Math.random() * 300) * 100) / 100,
      descricao: receita ? "Salário" : `Compra ${i}`, data_vencimento: data, data_realizacao: data,
      conta_id: contas[i % contas.length].id, categoria_id: categoria.id, status: "paga",
    });
  }
  // 5 contas fixas mensais com 60 meses à frente, como o app mantém.
  for (let s = 0; s < 5; s += 1) {
    const serie = crypto.randomBytes(16).toString("hex");
    for (let m = 0; m < 60; m += 1) {
      const data = new Date(hoje.getFullYear(), hoje.getMonth() + m, 10).toISOString().slice(0, 10);
      linhas.push({
        user_id: userId, tipo: "despesa", valor: 100 + s * 50,
        descricao: `Conta fixa ${s + 1} (Fixa) [Serie:${serie}]`, data_vencimento: data, data_realizacao: null,
        conta_id: contas[0].id, categoria_id: despesas[s % despesas.length].id, status: "pendente",
      });
    }
  }
  return linhas;
}

async function preparar() {
  const total = Math.max(1, Math.min(500, Number(arg1 ?? 200)));
  const { publica, secreta } = chaves();
  const contas = fs.existsSync(ARQUIVO_CONTAS) ? JSON.parse(fs.readFileSync(ARQUIVO_CONTAS, "utf8")) : [];
  console.log(`Preparando ${total} contas de teste (já existem ${contas.length})...`);
  while (contas.length < total) {
    const email = `carga-${contas.length + 1}-${crypto.randomBytes(3).toString("hex")}@example.com`;
    const senha = `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
    const criado = await http("POST", "/auth/v1/admin/users", {
      chave: secreta,
      corpo: {
        email, password: senha, email_confirm: true,
        user_metadata: { termos_versao: "2026-08-08-offline-seguranca-ia", data_nascimento: "1990-01-01", termos_aceitos_em: new Date().toISOString() },
      },
    });
    if (criado.status >= 300 || !criado.json?.id) throw new Error(`Falha ao criar conta de teste (${criado.status}).`);
    const conta = { email, senha, id: criado.json.id, populada: false };
    contas.push(conta);
    fs.writeFileSync(ARQUIVO_CONTAS, JSON.stringify(contas));
  }
  for (const [indice, conta] of contas.entries()) {
    if (conta.populada) continue;
    const { token, userId } = await entrar(publica, conta);
    const opcoes = { chave: publica, token, prefer: "return=representation" };
    const contasCriadas = await http("POST", "/rest/v1/contas", { ...opcoes, corpo: [
      { user_id: userId, nome: "Conta principal", saldo_inicial: 5000 },
      { user_id: userId, nome: "Carteira", saldo_inicial: 300 },
    ] });
    const categoriasCriadas = await http("POST", "/rest/v1/categorias", { ...opcoes, corpo: [
      ["Alimentação", "despesa"], ["Moradia", "despesa"], ["Transporte", "despesa"], ["Lazer", "despesa"],
      ["Salário", "receita"], ["Outros", "receita"],
    ].map(([nome, tipo]) => ({ user_id: userId, nome, tipo, cor: "#2A9D8F", icone: "label" })) });
    if (contasCriadas.status >= 300 || categoriasCriadas.status >= 300) {
      throw new Error(`Falha ao criar contas/categorias (${contasCriadas.status}/${categoriasCriadas.status}).`);
    }
    const linhas = lancamentosFicticios(userId, contasCriadas.json, categoriasCriadas.json);
    for (let i = 0; i < linhas.length; i += 300) {
      const r = await http("POST", "/rest/v1/transacoes", { chave: publica, token, corpo: linhas.slice(i, i + 300), prefer: "return=minimal" });
      if (r.status >= 300) throw new Error(`Falha ao gravar lançamentos (${r.status}): ${JSON.stringify(r.json).slice(0, 200)}`);
    }
    conta.populada = true;
    conta.contaId = contasCriadas.json[0].id;
    conta.categoriaId = categoriasCriadas.json.find((c) => c.tipo === "despesa").id;
    fs.writeFileSync(ARQUIVO_CONTAS, JSON.stringify(contas));
    if ((indice + 1) % 10 === 0) console.log(`  ${indice + 1}/${contas.length} contas com dados`);
  }
  console.log("Pronto. Contas guardadas em", ARQUIVO_CONTAS);
}

// ---------------------------------------------------------------- rodar
// As mesmas consultas que o Início do app faz ao abrir (app/(tabs)/index.tsx).
async function abrirInicio(publica, sessao, registrar) {
  const opcoes = { chave: publica, token: sessao.token };
  const inicio = performance.now();
  const rpc = await http("POST", "/rest/v1/rpc/refresh_my_recurring_schedules", { ...opcoes, corpo: {} });
  registrar("rpc_recorrencias", rpc);
  // As contas vêm antes porque o filtro das transações usa os ids delas
  // (como o app faz desde 02/10/2026, ver web/src/lib/transacoes-visiveis.ts).
  const contas = (async () => {
    const r = await http("GET", "/rest/v1/contas?select=*", opcoes);
    registrar("contas", r);
    return r;
  })();
  const consultas = [
    ["categorias", `/rest/v1/categorias?select=*&user_id=eq.${sessao.userId}`],
    ["parcerias", `/rest/v1/parcerias?select=id,solicitante_id,convidado_id&status=eq.aceito&or=(solicitante_id.eq.${sessao.userId},convidado_id.eq.${sessao.userId})`],
    ["caixinhas", "/rest/v1/caixinhas?select=id,nome,saldo_atual,meta_valor,data_prazo,cor,icone"],
    ["cartoes", `/rest/v1/cartoes?select=id,nome,dia_vencimento,dia_fechamento&user_id=eq.${sessao.userId}&ativo=eq.true`],
    ["fatura_itens", `/rest/v1/fatura_itens?select=id,cartao_id,descricao,valor,data_compra,mes_fatura,categoria_id,pago&user_id=eq.${sessao.userId}`],
  ];
  const todasTransacoes = (async () => {
    const rContas = await contas;
    const ids = Array.isArray(rContas.json) ? rContas.json.map((conta) => conta.id).join(",") : "";
    const filtro = encodeURIComponent(ids ? `(user_id.eq.${sessao.userId},conta_id.in.(${ids}))` : `(user_id.eq.${sessao.userId})`);
    for (let pagina = 0; pagina < 50; pagina += 1) {
      const de = pagina * 1000;
      const r = await http("GET", `/rest/v1/transacoes?select=id,tipo,valor,data_vencimento,data_realizacao,descricao,categoria_id,conta_id,status,transacao_pai_id&or=${filtro}&order=id.asc&offset=${de}&limit=1000`, opcoes);
      registrar("transacoes_pagina", r);
      if (r.status !== 200 || !Array.isArray(r.json) || r.json.length < 1000) return;
    }
  })();
  const resultados = await Promise.all(consultas.map(async ([nome, rota]) => {
    const r = await http("GET", rota, opcoes);
    registrar(nome, r);
    return r;
  }));
  await todasTransacoes;
  const rContas = await contas;
  const falhou = rpc.status >= 300 || rpc.status === 0 || rContas.status !== 200 || resultados.some((r) => r.status !== 200);
  registrar("abrir_inicio", { status: falhou ? 500 : 200, ms: performance.now() - inicio });
}

async function lancar(publica, sessao, conta, registrar) {
  const hoje = hojeSP();
  const r = await http("POST", "/rest/v1/rpc/execute_manual_financial_action", {
    chave: publica, token: sessao.token,
    corpo: {
      p_action_type: "create_transaction",
      p_payload: {
        type: "despesa", value: Math.round((5 + Math.random() * 95) * 100) / 100, description: "Lançamento de carga",
        status: "paga", scheduled_date: hoje, realization_date: hoje,
        account_id: conta.contaId, category_id: conta.categoriaId, frequency: "unica",
      },
      p_idempotency_key: crypto.randomUUID(),
      p_expected_user_id: sessao.userId,
      p_client_created_at: new Date().toISOString(),
    },
  });
  const ok = r.status === 200 && r.json?.ok === true;
  registrar("lancar", { status: ok ? 200 : (r.status === 200 ? 409 : r.status), ms: r.ms, codigo: r.json?.error_code ?? r.json?.message });
}

function percentil(valores, p) {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length))];
}

async function rodar() {
  const ondas = (arg1 ?? "20,50,100,200").split(",").map(Number).filter((n) => n > 0);
  const segundos = Math.max(10, Number(arg2 ?? 60));
  const contas = JSON.parse(fs.readFileSync(ARQUIVO_CONTAS, "utf8")).filter((c) => c.populada);
  const maximo = Math.max(...ondas);
  if (contas.length < maximo) throw new Error(`Há ${contas.length} contas preparadas; a maior onda pede ${maximo}.`);
  const { publica } = chaves();
  console.log(`Entrando com ${maximo} contas de teste...`);
  const sessoes = [];
  for (let i = 0; i < maximo; i += 1) {
    sessoes.push(await entrar(publica, contas[i]));
    await espera(250);
  }
  const relatorio = [];
  for (const pessoas of ondas) {
    const medidas = new Map();
    const codigos = new Map();
    const registrar = (nome, r) => {
      if (!medidas.has(nome)) medidas.set(nome, { ms: [], erros: 0 });
      const m = medidas.get(nome);
      m.ms.push(r.ms);
      if (r.status === 0 || r.status >= 300) {
        m.erros += 1;
        const chave = `${nome}:${r.status}${r.codigo ? `:${r.codigo}` : ""}`;
        codigos.set(chave, (codigos.get(chave) ?? 0) + 1);
      }
    };
    console.log(`\nOnda: ${pessoas} pessoas ao mesmo tempo, por ${segundos} s...`);
    const fim = Date.now() + segundos * 1000;
    await Promise.all(Array.from({ length: pessoas }, async (_, i) => {
      await espera(Math.random() * 2000); // não começam todas no mesmo milissegundo
      while (Date.now() < fim) {
        await abrirInicio(publica, sessoes[i], registrar);
        if (Math.random() < 0.5) await lancar(publica, sessoes[i], contas[i], registrar);
        await espera(1000 + Math.random() * 2000);
      }
    }));
    const linha = (nome) => {
      const m = medidas.get(nome) ?? { ms: [], erros: 0 };
      return {
        total: m.ms.length,
        porSegundo: (m.ms.length / segundos).toFixed(1),
        p50: Math.round(percentil(m.ms, 50)),
        p95: Math.round(percentil(m.ms, 95)),
        erros: m.ms.length ? `${((m.erros / m.ms.length) * 100).toFixed(1)}%` : "-",
      };
    };
    const abrir = linha("abrir_inicio");
    const gravar = linha("lancar");
    relatorio.push({ pessoas, abrir, gravar });
    console.log(`  Abrir o Início: ${abrir.porSegundo}/s · metade das vezes em até ${abrir.p50} ms · 95% em até ${abrir.p95} ms · erros ${abrir.erros}`);
    console.log(`  Lançar:         ${gravar.porSegundo}/s · metade das vezes em até ${gravar.p50} ms · 95% em até ${gravar.p95} ms · erros ${gravar.erros}`);
    if (codigos.size) console.log("  Erros:", Object.fromEntries([...codigos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)));
    const errosAbrir = parseFloat(abrir.erros) || 0;
    if (errosAbrir > 20 || abrir.p95 > 15_000) {
      console.log("  Parando aqui: mais de 20% de erros ou respostas acima de 15 s. Este é o limite.");
      break;
    }
  }
  console.log("\nResumo (pessoas simultâneas → aberturas/s, p95 abrir, lançamentos/s, p95 lançar, erros):");
  for (const { pessoas, abrir, gravar } of relatorio) {
    console.log(`  ${String(pessoas).padStart(4)} → ${abrir.porSegundo}/s, ${abrir.p95} ms | ${gravar.porSegundo}/s, ${gravar.p95} ms | erros ${abrir.erros} / ${gravar.erros}`);
  }
}

async function limpar() {
  const { secreta } = chaves();
  if (!fs.existsSync(ARQUIVO_CONTAS)) return console.log("Nada para limpar.");
  const contas = JSON.parse(fs.readFileSync(ARQUIVO_CONTAS, "utf8"));
  let removidas = 0;
  for (const conta of contas) {
    const r = await http("DELETE", `/auth/v1/admin/users/${conta.id}`, { chave: secreta });
    if (r.status < 300) removidas += 1;
  }
  fs.rmSync(ARQUIVO_CONTAS);
  console.log(`${removidas}/${contas.length} contas de teste removidas e arquivo local apagado.`);
}

({ preparar, rodar, limpar })[comando]().catch((erro) => {
  console.error("ERRO:", erro.message);
  process.exit(1);
});
