import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";

// Preferências e valores digitados que antes ficavam SÓ no navegador
// (localStorage) — agora no banco (schema v59, tabela `preferencias_loja`:
// uma linha por loja × chave, valor jsonb), com realtime: entrou de outro
// computador ou celular, está igual. Regra do Gustavo (16/10/2026): nenhum
// dado pode ficar preso num aparelho.
//
// Store ÚNICO (uma busca + um canal de realtime). Sem a tabela (v59 não
// rodado) → `disponivel` false e o app continua lendo/gravando no
// localStorage como antes. Na 1ª vez com a tabela, o valor que existia no
// navegador SOBE pro banco (`legado`) — nada se perde.
const VAZIO = { valores: new Map(), disponivel: true, carregado: false, lojaId: undefined };
let estado = VAZIO;
const ouvintes = new Set();
let lojaAtual;
let canal = null;
let timer = null;
let usuarios = 0;
let seq = 0;
let geracao = 0;

const publicar = (novo) => {
  estado = novo;
  ouvintes.forEach((f) => f());
};

async function carregar() {
  if (!supabase) return publicar({ ...VAZIO, disponivel: false, carregado: true, lojaId: lojaAtual });
  const g = ++geracao;
  const lojaId = lojaAtual;
  try {
    let q = supabase.from("preferencias_loja").select("chave, valor");
    q = lojaId ? q.eq("loja_id", lojaId) : q.is("loja_id", null);
    const r = await q;
    if (g !== geracao) return;
    if (r.error) return publicar({ ...VAZIO, disponivel: false, carregado: true, lojaId });
    publicar({ valores: new Map((r.data || []).map((x) => [x.chave, x.valor])), disponivel: true, carregado: true, lojaId });
  } catch {
    if (g === geracao) publicar({ ...estado, carregado: true });
  }
}
const agendar = () => {
  clearTimeout(timer);
  timer = setTimeout(carregar, 200);
};
const aoVoltar = () => document.visibilityState === "visible" && agendar();
function ligar() {
  if (!supabase || canal) return;
  canal = supabase
    .channel(`preferencias-${++seq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "preferencias_loja" }, agendar)
    .subscribe();
  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("focus", agendar);
}
function desligar() {
  if (!canal) return;
  supabase.removeChannel(canal);
  canal = null;
  document.removeEventListener("visibilitychange", aoVoltar);
  window.removeEventListener("focus", agendar);
}
const assinar = (f) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};

const lerLocal = (k) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? undefined : JSON.parse(v);
  } catch {
    try {
      return localStorage.getItem(k) ?? undefined;
    } catch {
      return undefined;
    }
  }
};
const gravarLocal = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // sem localStorage
  }
};

// Cópia local por LOJA (cada loja tem a sua; trocar de loja nunca mostra o
// valor da outra).
const chaveLocal = (lojaId, chave) => `ohra:pref:${lojaId || "sem-loja"}:${chave}`;

/** Grava uma preferência da loja no banco (e no cache local). */
export async function gravarPreferencia(chave, valor, lojaId = lojaAtual) {
  const valores = new Map(estado.valores);
  valores.set(chave, valor);
  publicar({ ...estado, valores }); // otimista: a tela muda na hora
  gravarLocal(chaveLocal(lojaId, chave), valor);
  if (!supabase || !estado.disponivel) return { ok: true, soLocal: true };
  const { error } = await supabase
    .from("preferencias_loja")
    .upsert({ loja_id: lojaId || null, chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "loja_id,chave" });
  return error ? { ok: false, msg: error.message } : { ok: true };
}

/**
 * [valor, setValor, info] de uma preferência da loja.
 * - padrao: valor quando não há nada salvo.
 * - legado: chave antiga do localStorage (ou função que devolve o valor antigo)
 *   — sobe pro banco na 1ª vez.
 * - legadoPorLoja: o valor antigo já era separado por loja (sobe pra cada uma);
 *   sem isso, o antigo era UM só pra todas e sobe só pra loja que abrir primeiro.
 * - atraso: ms pra juntar digitação antes de gravar (padrão 600).
 */
export function usePreferencia(chave, padrao, { legado = null, legadoPorLoja = false, atraso = 600 } = {}) {
  const { lojaId } = useLoja();
  const s = useSyncExternalStore(assinar, () => estado, () => estado);
  useEffect(() => {
    usuarios++;
    if (!canal || lojaAtual !== lojaId || estado.lojaId !== lojaId) {
      lojaAtual = lojaId;
      carregar();
    }
    ligar();
    return () => {
      usuarios--;
      if (usuarios <= 0) desligar();
    };
  }, [lojaId]);

  const daLoja = s.lojaId === lojaId;
  const temNoBanco = daLoja && s.valores.has(chave);
  const valorLegado = () => (typeof legado === "function" ? legado() : legado ? lerLocal(legado) : undefined);

  // 1ª vez com a tabela: o valor que estava só neste navegador sobe pro banco.
  const migrou = useRef(false);
  useEffect(() => {
    if (migrou.current || !daLoja || !s.carregado || !s.disponivel || temNoBanco) return;
    migrou.current = true;
    const v = valorLegado();
    // Só sobe o que tem conteúdo de verdade: um aparelho sem nada salvo não
    // pode ocupar a vaga do que está guardado em outro (o 1º com dado ganha).
    const vazio = v === undefined || v === null || v === "" || JSON.stringify(v) === JSON.stringify(padrao) || (typeof v === "object" && Object.keys(v).length === 0) || (typeof v === "object" && Object.values(v).every((x) => x === "" || x == null));
    // Valor antigo COMPARTILHADO (um só pra todas as lojas): sobe só uma vez,
    // pra loja que abrir primeiro — não copia pra outra loja.
    const marca = legadoPorLoja ? null : `ohra:pref-migrado:${chave}`;
    if (marca && lerLocal(marca)) return;
    if (!vazio) {
      gravarPreferencia(chave, v, lojaId);
      if (marca) gravarLocal(marca, lojaId || "sem-loja");
    }
  });

  let valor;
  if (temNoBanco) valor = s.valores.get(chave);
  else {
    const cache = lerLocal(chaveLocal(lojaId, chave));
    const v = cache !== undefined ? cache : valorLegado();
    valor = v !== undefined && v !== null ? v : padrao;
  }

  const pendente = useRef(null);
  const valorAtualRef = useRef(valor);
  useEffect(() => {
    valorAtualRef.current = valor;
  });
  const setValor = useCallback(
    (novo) => {
      const v = typeof novo === "function" ? novo(valorAtualRef.current) : novo;
      valorAtualRef.current = v;
      const valores = new Map(estado.valores);
      valores.set(chave, v);
      publicar({ ...estado, valores });
      gravarLocal(chaveLocal(lojaId, chave), v);
      clearTimeout(pendente.current);
      pendente.current = setTimeout(() => gravarPreferencia(chave, v, lojaId), atraso);
    },
    [chave, lojaId, atraso]
  );
  return [valor, setValor, { disponivel: s.disponivel, carregado: s.carregado }];
}

/** Leitura direta (fora de componente): banco › cache local › undefined. */
export function lerPreferencia(chave) {
  if (estado.lojaId === lojaAtual && estado.valores.has(chave)) return estado.valores.get(chave);
  return lerLocal(chaveLocal(lojaAtual, chave));
}
