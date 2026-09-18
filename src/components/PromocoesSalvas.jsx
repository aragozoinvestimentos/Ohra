import { useEffect, useMemo, useState } from "react";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { TIPOS } from "../lib/promocaoTipos.js";

function labelTipo(tipo) {
  return TIPOS.find((t) => t.key === tipo)?.label || tipo || "—";
}

// Lista das promoções salvas em "Promoções → Simular promoção" — mesmo
// padrão de Orçamentos salvos, só que cada linha guarda também o tipo de
// promoção e um resumo em texto da configuração usada (desconto %, leve/pague,
// tiers do progressivo…), já que cada tipo calcula de um jeito diferente e
// nem sempre tem um preço único (ex: Progressivo).
export default function PromocoesSalvas({ onToast }) {
  const { lojaId } = useLoja();
  const [promocoes, setPromocoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editAlvo, setEditAlvo] = useState(null); // linha inteira sendo editada
  const [edicao, setEdicao] = useState({ nome: "", preco: "", lucro: "", resumo: "" });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recemSalvoId, setRecemSalvoId] = useState(null);
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }

    let ativo = true;

    async function carregar() {
      try {
        let query = supabase.from("promocoes_salvas").select("*").order("criado_em", { ascending: false });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setPromocoes(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("promocoes-salvas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "promocoes_salvas" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function excluir(id) {
    if (!supabase) return;
    const { error } = await supabase.from("promocoes_salvas").delete().eq("id", id);
    if (error) {
      onToast?.("Não foi possível excluir agora — tente de novo");
      return;
    }
    setPromocoes((prev) => prev.filter((p) => p.id !== id));
  }

  // Editar aqui é editar o RESULTADO já salvo (preço/lucro/resumo) — não tem
  // como recalcular a partir de custo+canal porque a promoção salva só
  // guarda o resultado final (cada tipo de promoção chega nesse número de
  // um jeito diferente, ver PromocaoSimulador.jsx), sem o custo nem o canal
  // por trás. Por isso Preço e Lucro são dois campos livres, e a Margem é só
  // derivada dos dois pra sempre bater (igual Preços por Canal, mas sem uma
  // faixa de comissão real pra reavaliar).
  function iniciarEdicao(p) {
    setEditAlvo(p);
    setEdicao({
      nome: p.nome || "",
      preco: p.preco != null ? String(p.preco) : "",
      lucro: p.lucro != null ? String(p.lucro) : "",
      resumo: p.resumo || "",
    });
  }

  const margemEdicao = useMemo(() => {
    const preco = parseFloat(String(edicao.preco).replace(",", "."));
    const lucro = parseFloat(String(edicao.lucro).replace(",", "."));
    if (!isFinite(preco) || preco <= 0 || !isFinite(lucro)) return null;
    return lucro / preco;
  }, [edicao.preco, edicao.lucro]);

  async function salvarEdicao() {
    const id = editAlvo.id;
    const nome = edicao.nome.trim();
    if (!nome) {
      onToast?.("O nome não pode ficar vazio");
      return;
    }
    const precoNum = parseFloat(String(edicao.preco).replace(",", "."));
    const lucroNum = parseFloat(String(edicao.lucro).replace(",", "."));
    const resumo = edicao.resumo.trim();
    setSalvandoEdicao(true);
    const { error } = await supabase
      .from("promocoes_salvas")
      .update({
        nome,
        preco: isFinite(precoNum) ? arredondarPreco(precoNum) : null,
        lucro: isFinite(lucroNum) ? arredondarPreco(lucroNum) : null,
        margem: margemEdicao,
        resumo: resumo || null,
      })
      .eq("id", id);
    setSalvandoEdicao(false);
    if (error) {
      onToast?.("Não foi possível salvar — tente de novo");
      return;
    }
    setPromocoes((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              nome,
              preco: isFinite(precoNum) ? arredondarPreco(precoNum) : null,
              lucro: isFinite(lucroNum) ? arredondarPreco(lucroNum) : null,
              margem: margemEdicao,
              resumo: resumo || null,
            }
          : p
      )
    );
    setEditAlvo(null);
    setRecemSalvoId(id);
    setTimeout(() => setRecemSalvoId((atual) => (atual === id ? null : atual)), 1000);
    onToast?.("Promoção atualizada");
  }

  return (
    <div className="panel">
      <h3>Promoções salvas</h3>
      {!supabase ? (
        <div className="empty">Promoções salvas indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      ) : carregando ? (
        <div className="empty">Carregando…</div>
      ) : promocoes.length === 0 ? (
        <div className="empty">Nenhuma promoção salva ainda. Configure uma em "Simular promoção" e clique em "Salvar".</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Promoção</th>
                <th>Tipo</th>
                <th>Item / Canal</th>
                <th className="num">Preço</th>
                <th className="num">Lucro</th>
                <th className="num">Margem</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {promocoes.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.nome || "—"}
                    {recemSalvoId === p.id && <span className="salvo-check">✓</span>}
                    {p.resumo && (
                      <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.85em" }}>
                        {p.resumo}
                      </div>
                    )}
                  </td>
                  <td>{labelTipo(p.tipo)}</td>
                  <td>
                    {p.item_nome || "—"}
                    {p.canal_nome ? ` — ${p.canal_nome}` : ""}
                  </td>
                  <td className="num">{p.preco != null ? BRL(p.preco) : "—"}</td>
                  <td className="num">{p.lucro != null ? BRL(p.lucro) : "—"}</td>
                  <td className="num">{p.margem != null ? PCT(p.margem) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="del" title="Editar" onClick={() => iniciarEdicao(p)}>✎</button>
                    <button className="del" title="Excluir" onClick={() => setExcluirAlvo(p)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editAlvo && (
        <EditarDialog
          titulo={`Editar promoção — ${editAlvo.item_nome || "—"}${editAlvo.canal_nome ? ` em ${editAlvo.canal_nome}` : ""}`}
          salvando={salvandoEdicao}
          onSalvar={salvarEdicao}
          onCancelar={() => setEditAlvo(null)}
        >
          <div className="field">
            <label>Nome da promoção</label>
            <input
              type="text"
              autoFocus
              value={edicao.nome}
              onChange={(e) => setEdicao((prev) => ({ ...prev, nome: e.target.value }))}
            />
          </div>
          <div className="row2">
            <div className="field">
              <label>Preço</label>
              <input
                type="number"
                step="0.01"
                value={edicao.preco}
                onChange={(e) => setEdicao((prev) => ({ ...prev, preco: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Lucro</label>
              <input
                type="number"
                step="0.01"
                value={edicao.lucro}
                onChange={(e) => setEdicao((prev) => ({ ...prev, lucro: e.target.value }))}
              />
            </div>
          </div>
          <div className="destaque-lucro" style={{ marginBottom: 12 }}>
            <span className="k">Margem</span>
            <span className="v">{margemEdicao != null ? PCT(margemEdicao) : "—"}</span>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Resumo (texto livre — configuração usada)</label>
            <textarea
              rows={3}
              value={edicao.resumo}
              onChange={(e) => setEdicao((prev) => ({ ...prev, resumo: e.target.value }))}
            />
          </div>
          <div className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Preço e lucro aqui são só o resultado guardado — editar não refaz a conta a partir do custo/canal (a promoção não guarda esses dados), a margem é sempre lucro ÷ preço dos dois valores acima.
          </div>
        </EditarDialog>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir promoção"
          mensagem={`Confirma excluir "${excluirAlvo.nome || "este item"}"? Não é possível desfazer.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo.id);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}
    </div>
  );
}
