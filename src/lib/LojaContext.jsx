import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

const LOJA_KEY = "ohra:loja-atual";
const DESBLOQUEADAS_KEY = "ohra:lojas-desbloqueadas";

// disponivel=false enquanto a tabela "lojas" não existir (schema_v3.sql não
// rodado ainda) — nesse caso o app funciona igual antes, sem filtrar por loja.
const LojaContext = createContext({
  lojas: [],
  lojaId: null,
  disponivel: false,
  carregando: true,
  selecionar: () => {},
  criar: async () => null,
  atualizar: async () => false,
  remover: async () => false,
  precisaPin: () => false,
  desbloquear: () => false,
  conferirPin: () => true,
});

function lerSalvo() {
  try {
    return localStorage.getItem(LOJA_KEY);
  } catch {
    return null;
  }
}

// PINs desbloqueados ficam só nesta aba/sessão (sessionStorage) — fechar o
// navegador tranca de novo as lojas com PIN.
function lerDesbloqueadas() {
  try {
    const raw = sessionStorage.getItem(DESBLOQUEADAS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function salvarDesbloqueadas(set) {
  try {
    sessionStorage.setItem(DESBLOQUEADAS_KEY, JSON.stringify([...set]));
  } catch {
    // sem problema, só não lembra na próxima aba
  }
}

// Extrai o caminho do objeto (relativo ao bucket) a partir da URL pública,
// pra dar pra remover do Storage quando a loja é excluída.
function caminhoDoIcone(url) {
  const marcador = "/loja-icones/";
  const idx = url.indexOf(marcador);
  return idx === -1 ? null : url.slice(idx + marcador.length);
}

export function LojaProvider({ children }) {
  const [lojas, setLojas] = useState([]);
  const [lojaId, setLojaId] = useState(null);
  const [disponivel, setDisponivel] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [desbloqueadas, setDesbloqueadas] = useState(lerDesbloqueadas);

  const carregar = useCallback(async () => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    try {
      const { data, error } = await supabase.from("lojas").select("*").order("criado_em", { ascending: true });
      if (error) throw error;
      setDisponivel(true);
      setLojas(data || []);
      setLojaId((atual) => {
        if (atual && data.some((l) => l.id === atual)) return atual;
        const salvo = lerSalvo();
        if (salvo && data.some((l) => l.id === salvo)) return salvo;
        return data[0]?.id || null;
      });
    } catch {
      // tabela "lojas" ainda não existe — multi-loja fica invisível
      setDisponivel(false);
      setLojas([]);
      setLojaId(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    if (!supabase) return;
    const canal = supabase
      .channel("lojas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "lojas" }, carregar)
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [carregar]);

  function selecionar(id) {
    setLojaId(id);
    try {
      localStorage.setItem(LOJA_KEY, id);
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }

  function marcarDesbloqueada(id) {
    setDesbloqueadas((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      salvarDesbloqueadas(next);
      return next;
    });
  }

  // Uma loja só pede PIN se tiver um cadastrado E ainda não tiver sido
  // desbloqueada nesta sessão.
  function precisaPin(id) {
    const loja = lojas.find((l) => l.id === id);
    return !!(loja?.pin && !desbloqueadas.has(id));
  }

  // Confere o PIN de uma loja e, se bater, desbloqueia (nesta sessão) e já
  // troca pra ela. Devolve true/false pra tela mostrar erro ou fechar.
  function desbloquear(id, pinDigitado) {
    const loja = lojas.find((l) => l.id === id);
    if (!loja) return false;
    if (loja.pin && loja.pin !== pinDigitado) return false;
    marcarDesbloqueada(id);
    selecionar(id);
    return true;
  }

  // Confere o PIN sem trocar de loja — usado pra autorizar excluir uma loja
  // protegida por PIN. Sem PIN cadastrado, qualquer coisa "confere".
  function conferirPin(id, pinDigitado) {
    const loja = lojas.find((l) => l.id === id);
    if (!loja) return false;
    return !loja.pin || loja.pin === pinDigitado;
  }

  async function criar({ nome, pin }) {
    if (!supabase) return null;
    const payload = { nome };
    if (pin) payload.pin = pin;
    const { data, error } = await supabase.from("lojas").insert(payload).select().single();
    if (error) return null;
    // Atualiza a lista local na hora — sem isso o seletor fica sem nenhuma
    // opção correspondente até o round-trip do realtime voltar.
    setLojas((prev) => (prev.some((l) => l.id === data.id) ? prev : [...prev, data]));
    // Quem acabou de criar a loja já sabe o PIN que digitou — não faz
    // sentido pedir de volta na mesma hora.
    if (pin) marcarDesbloqueada(data.id);
    selecionar(data.id);
    // Toda loja nova já nasce com Shopee e Mercado Livre cadastrados —
    // mesmo padrão da loja default (item ajustável depois em Canais).
    try {
      await supabase.from("canais").insert([
        { nome: "Shopee", tipo: "shopee", loja_id: data.id },
        { nome: "Mercado Livre", tipo: "ml", loja_id: data.id },
      ]);
    } catch {
      // falha de rede ao semear os canais padrão — a loja já foi criada;
      // dá pra cadastrar os canais manualmente em Cadastros → Canais.
    }
    return data;
  }

  async function atualizar(id, { nome, pin, iconeUrl, removerIcone } = {}) {
    if (!supabase) return false;
    const patch = {};
    if (nome !== undefined) patch.nome = nome;
    if (pin !== undefined) patch.pin = pin || null;
    if (removerIcone) patch.icone_url = null;
    else if (iconeUrl !== undefined) patch.icone_url = iconeUrl;
    const { data, error } = await supabase.from("lojas").update(patch).eq("id", id).select().single();
    if (error) return false;
    setLojas((prev) => prev.map((l) => (l.id === id ? data : l)));
    // Quem definiu/trocou o PIN agora mesmo já sabe ele.
    if (patch.pin) marcarDesbloqueada(id);
    return true;
  }

  async function remover(id) {
    if (!supabase) return false;
    const loja = lojas.find((l) => l.id === id);
    const { error } = await supabase.from("lojas").delete().eq("id", id);
    if (error) return false;
    setLojas((prev) => prev.filter((l) => l.id !== id));
    setDesbloqueadas((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      salvarDesbloqueadas(next);
      return next;
    });
    if (loja?.icone_url) {
      try {
        const caminho = caminhoDoIcone(loja.icone_url);
        if (caminho) await supabase.storage.from("loja-icones").remove([caminho]);
      } catch {
        // arquivo órfão no Storage não é grave — a loja já foi excluída
      }
    }
    return true;
  }

  return (
    <LojaContext.Provider
      value={{ lojas, lojaId, disponivel, carregando, selecionar, criar, atualizar, remover, precisaPin, desbloquear, conferirPin }}
    >
      {children}
    </LojaContext.Provider>
  );
}

export function useLoja() {
  return useContext(LojaContext);
}
