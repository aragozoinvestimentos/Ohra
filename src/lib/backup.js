// Backup geral (24/10/2026): TODAS as lojas e TODAS as tabelas de dado do app
// num arquivo .json (decisão do Gustavo: um backup só, de todas as lojas — se
// perder o dele, recupera pelo do amigo). Lembrete a cada BACKUP_DIAS, com
// "Gerar e baixar" no Início (Seus dados) e no consultor da Sede.
//
// REGRA: toda tabela NOVA (schema_vN.sql) entra em TABELAS_BACKUP — senão o
// dado dela fica fora do backup. A lista tem o que existe hoje (v65).
import { supabase } from "./supabaseClient.js";
import { hojeSP } from "./datas.js";

export const BACKUP_DIAS = 15;
export const CHAVE_BACKUP = "backup:ultimo"; // preferencias_loja: { data, tabelas, linhas }

export const TABELAS_BACKUP = [
  "lojas", "canais", "materiais", "compras_material", "embalagens",
  "produtos_cadastro", "produto_embalagens", "produto_variacoes", "kits", "kit_produtos", "kit_embalagens",
  "precos_canal", "precos_concorrente", "publicacoes_canal", "anuncios_grupo",
  "orcamentos_avulsos", "promocoes_salvas", "metas_mensais",
  "registros_impressao", "impressoras", "farm_config", "farm_alteracoes", "manutencoes",
  "lancamentos_caixa", "reserva_producao", "vendas_organicas",
  "rampas_preco", "rampa_registros", "ads_periodos",
  "afiliado_config", "afiliados", "afiliado_registros",
  "lembretes", "tarefas", "preferencias_loja",
  "pedidos_itens", "importacoes", "skus_ignorados", "avaliacoes_produto",
  "lives", "live_eventos", "acoes_comerciais", "consultor_registros",
  "fornecedores", "fornecedor_itens", "compras_revenda", "compras_revenda_itens", "estoque_movimentos",
  "extrato_carteira",
];

const PAGINA = 1000; // o Supabase devolve no máximo 1000 linhas por busca

async function lerTabela(tabela) {
  const linhas = [];
  let ordenar = true;
  for (let de = 0; ; de += PAGINA) {
    let q = supabase.from(tabela).select("*");
    if (ordenar) q = q.order("id", { ascending: true });
    let { data, error } = await q.range(de, de + PAGINA - 1);
    if (error && ordenar && de === 0) {
      // tabela sem coluna id: lê sem ordem
      ordenar = false;
      ({ data, error } = await supabase.from(tabela).select("*").range(0, PAGINA - 1));
    }
    if (error) return { erro: error.message, linhas };
    linhas.push(...(data || []));
    if (!data || data.length < PAGINA) return { linhas };
  }
}

/** Lê tudo e baixa o arquivo. → { ok, tabelas, linhas, falhas } */
export async function gerarBackup() {
  if (!supabase) return { ok: false, falhas: [{ tabela: "*", erro: "sem banco" }] };
  const dados = {};
  const falhas = [];
  let linhas = 0;
  for (const tabela of TABELAS_BACKUP) {
    const r = await lerTabela(tabela);
    if (r.erro) {
      // tabela que ainda não existe (SQL não rodado) não impede o resto — fica anotada no arquivo
      falhas.push({ tabela, erro: r.erro });
      continue;
    }
    dados[tabela] = r.linhas;
    linhas += r.linhas.length;
  }
  if (!Object.keys(dados).length) return { ok: false, falhas };
  const payload = { geradoEm: new Date().toISOString(), app: "Margem Real", tabelas: dados, ...(falhas.length ? { tabelasComErro: falhas } : {}) };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-margem-real-${hojeSP()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true, tabelas: Object.keys(dados).length, linhas, falhas };
}

/** Situação do backup pelo último registro → { dias, vencido, texto } */
export function estadoBackup(ultimo, hoje) {
  const data = ultimo?.data || null;
  if (!data) return { dias: null, vencido: true, texto: "nunca feito" };
  const dias = Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${data}T12:00:00`)) / 86400000);
  return { dias, vencido: dias >= BACKUP_DIAS, texto: dias === 0 ? "feito hoje" : dias === 1 ? "feito ontem" : `feito há ${dias} dias` };
}
