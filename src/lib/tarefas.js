// Tarefas manuais do Início (schema v42) — lógica pura.
// Cor/grupo pela regra única (lib/estados.js): vencida = Resolver (vermelho,
// "! vencida"); hoje/amanhã = Atenção e rotina (âmbar); data futura ou sem
// data = Atenção e rotina, sem cor. Ordem = por data (sem data no fim).
import { dataSP } from "./datas.js";

export const REPETIR = [
  { valor: "", rotulo: "Não repete" },
  { valor: "semanal", rotulo: "Toda semana" },
  { valor: "mensal", rotulo: "Todo mês" },
];

// Abas que uma tarefa pode abrir; `item` = a aba recebe o item escolhido.
export const ABAS_TAREFA = [
  { key: "historico", rotulo: "Produtos precificados", item: true },
  { key: "producao", rotulo: "Custo de Produção", item: "produto" },
  { key: "avulso", rotulo: "Precificação · 1º Avulso", item: true },
  { key: "quantidade", rotulo: "Precificação · 2º Por quantidade", item: true },
  { key: "ficha", rotulo: "Precificação · 3º Ficha do anúncio", item: true },
  { key: "lancamento", rotulo: "Precificação · 4º Lançamento", item: true },
  { key: "publicar", rotulo: "Precificação · 5º Anunciar" },
  { key: "cadastros", rotulo: "Cadastros" },
  { key: "crescimento", rotulo: "Crescimento" },
  { key: "promocoes", rotulo: "Promoções" },
  { key: "orcamento", rotulo: "Orçamento" },
  { key: "registroImpressoes", rotulo: "Registro de Impressões" },
  { key: "caixa", rotulo: "Fluxo de Caixa" },
  { key: "metas", rotulo: "Metas" },
  { key: "ranking", rotulo: "Ranking por Retorno" },
];
export const abaTarefa = (key) => ABAS_TAREFA.find((a) => a.key === key) || null;

const meio = (iso) => new Date(`${iso}T12:00:00`);
const isoDe = (d) => d.toISOString().slice(0, 10);
export const somarDias = (iso, n) => {
  const d = meio(iso);
  d.setDate(d.getDate() + n);
  return isoDe(d);
};
// Mesmo dia no mês seguinte, limitado ao fim do mês (31/01 → 28 ou 29/02).
export function somarMes(iso) {
  const [a, m, dia] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(a, m, Math.min(dia, ultimo), 12));
  return isoDe(d);
}

// Data da próxima ocorrência ao concluir uma tarefa que repete. Base = a
// data dela (sem data = hoje); se ainda ficar no passado, avança até hoje+.
export function proximaData(t, hoje) {
  if (!t?.repetir) return null;
  const passo = (iso) => (t.repetir === "semanal" ? somarDias(iso, 7) : somarMes(iso));
  let d = passo(t.vence ? String(t.vence).slice(0, 10) : hoje);
  for (let i = 0; i < 400 && d < hoje; i++) d = passo(d);
  return d;
}

const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// → { grupo: 'resolver'|'rotina', tipo: estado|null, rotulo, ordemData }
export function estadoTarefa(t, hoje) {
  const v = t.vence ? String(t.vence).slice(0, 10) : null;
  if (v && v < hoje) return { grupo: "resolver", tipo: "resolver", rotulo: `vencida ${diaMes(v)}`, vencida: true, data: v };
  if (v === hoje) return { grupo: "rotina", tipo: "atencao", rotulo: "hoje", data: v };
  if (v && v === somarDias(hoje, 1)) return { grupo: "rotina", tipo: "atencao", rotulo: "amanhã", data: v };
  return { grupo: "rotina", tipo: null, rotulo: v ? diaMes(v) : "sem data", data: v };
}

export const tarefasAbertas = (tarefas) => (tarefas || []).filter((t) => !t.concluida_em);
// Concluídas nos últimos 7 dias, mais recentes primeiro.
export function concluidasRecentes(tarefas, hoje) {
  const limite = somarDias(hoje, -7);
  return (tarefas || [])
    .filter((t) => t.concluida_em && dataSP(t.concluida_em) >= limite)
    .sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em)));
}

// Pendências do "Pra fazer" (mesmo formato de montarPendencias).
export function pendenciasDeTarefas(tarefas, hoje) {
  return tarefasAbertas(tarefas).map((t) => {
    const e = estadoTarefa(t, hoje);
    return {
      id: `tarefa|${t.id}`,
      grupo: e.grupo,
      ordem: e.grupo === "resolver" ? 6 : e.tipo ? 0 : 9, // hoje/amanhã no topo do grupo; futuras/sem data no fim
      data: e.data,
      tom: e.tipo === "resolver" ? "bad" : e.tipo === "atencao" ? "warn" : null,
      semCor: !e.tipo,
      titulo: t.descricao,
      texto: "",
      tarefa: t,
      estadoTarefa: e,
    };
  });
}
