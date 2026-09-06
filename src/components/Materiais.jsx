import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CalculadoraPreco from "./CalculadoraPreco.jsx";

const VAZIO = { nome: "", preco: "", unidade: "un", tipo: "filamento", observacao: "" };

// Fora do Materiais() de propósito: se ficasse dentro, seria recriado a cada
// tecla digitada e o input perderia o foco a cada caractere.
function CampoPreco({ material, edicoes, setEdicoes, onSalvar }) {
  const [salvo, disparar] = useSalvoFlash();
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <input
        type="number"
        step="0.01"
        style={{ width: 90, textAlign: "right" }}
        value={edicoes[material.id] ?? material.preco}
        onChange={(e) => setEdicoes((prev) => ({ ...prev, [material.id]: e.target.value }))}
        onBlur={async () => {
          if (edicoes[material.id] !== undefined && parseFloat(edicoes[material.id]) !== material.preco) {
            const ok = await onSalvar(material.id);
            if (ok) disparar();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      {salvo && <span className="salvo-check">✓</span>}
    </span>
  );
}

function TabelaMateriais({ titulo, itens, vazio, comUnidade, edicoes, setEdicoes, onSalvarPreco, onExcluir }) {
  return (
    <div className="panel">
      <h3>{titulo}</h3>
      {itens.length === 0 ? (
        <div className="empty">{vazio}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th className="num">{comUnidade ? "Preço" : "Preço / kg"}</th>
                {comUnidade && <th>Unidade</th>}
                <th>Observação</th>
                <th>Atualizado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((m) => (
                <tr key={m.id}>
                  <td>{m.nome}</td>
                  <td className="num">
                    <CampoPreco material={m} edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={onSalvarPreco} />
                  </td>
                  {comUnidade && <td>{m.unidade || "un"}</td>}
                  <td>{m.observacao || "—"}</td>
                  <td>{new Date(m.atualizado_em).toLocaleDateString("pt-BR")}</td>
                  <td>
                    <button className="del" title="Excluir" onClick={() => onExcluir(m)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Materiais({ onToast }) {
  const { lojaId } = useLoja();
  const [materiais, setMateriais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(VAZIO);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoes, setEdicoes] = useState({}); // id -> valor em edição (preco como string)
  const [excluirAlvo, setExcluirAlvo] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;

    async function carregar() {
      try {
        let query = supabase.from("materiais").select("*").order("nome", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setMateriais(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("materiais-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiais" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function adicionar() {
    const nome = novo.nome.trim();
    const preco = parseFloat(novo.preco);
    if (!nome || !isFinite(preco)) {
      onToast("Preencha nome e preço");
      return;
    }
    setSalvandoNovo(true);
    const { error } = await supabase.from("materiais").insert({
      nome,
      preco,
      unidade: novo.tipo === "filamento" ? "kg" : novo.unidade.trim() || "un",
      tipo: novo.tipo,
      observacao: novo.observacao.trim() || null,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvandoNovo(false);
    if (error) {
      onToast(`Não foi possível adicionar: ${error.message}`);
      return;
    }
    setNovo({ ...VAZIO, tipo: novo.tipo });
    onToast("Material adicionado");
  }

  async function salvarPreco(id) {
    const valor = parseFloat(edicoes[id]);
    if (!isFinite(valor)) {
      onToast("Preço inválido");
      return false;
    }
    const { error } = await supabase
      .from("materiais")
      .update({ preco: valor, atualizado_em: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      onToast(`Não foi possível atualizar: ${error.message}`);
      return false;
    }
    setEdicoes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    return true;
  }

  async function excluir(id) {
    const { error } = await supabase.from("materiais").delete().eq("id", id);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    setMateriais((prev) => prev.filter((m) => m.id !== id));
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Materiais</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  const filamentos = materiais.filter((m) => (m.tipo || "filamento") === "filamento");
  const consumiveis = materiais.filter((m) => m.tipo === "consumivel");

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">Adicionar material</h3>
        <div className="field">
          <label>Tipo</label>
          <select value={novo.tipo} onChange={(e) => setNovo((p) => ({ ...p, tipo: e.target.value }))}>
            <option value="filamento">Filamento (preço por kg)</option>
            <option value="consumivel">Consumível — cola, lixa, tinta... (preço por unidade)</option>
          </select>
        </div>
        <div className="row3">
          <div className="field">
            <label>Nome</label>
            <input
              type="text"
              placeholder={novo.tipo === "filamento" ? "ex: PETG Premium" : "ex: Cola bastão"}
              value={novo.nome}
              onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>{novo.tipo === "filamento" ? "Preço por kg (R$)" : "Preço por unidade (R$)"}</label>
            <input
              type="number"
              step="0.01"
              value={novo.preco}
              onChange={(e) => setNovo((p) => ({ ...p, preco: e.target.value }))}
            />
          </div>
          {novo.tipo === "consumivel" ? (
            <div className="field">
              <label>Unidade (un, ml, g...)</label>
              <input
                type="text"
                placeholder="un"
                value={novo.unidade}
                onChange={(e) => setNovo((p) => ({ ...p, unidade: e.target.value }))}
              />
            </div>
          ) : (
            <div className="field">
              <label>Observação (opcional)</label>
              <input
                type="text"
                value={novo.observacao}
                onChange={(e) => setNovo((p) => ({ ...p, observacao: e.target.value }))}
              />
            </div>
          )}
        </div>
        <CalculadoraPreco
          unidade={novo.tipo === "filamento" ? "kg" : novo.unidade.trim() || "un"}
          onAplicar={(v) => setNovo((p) => ({ ...p, preco: String(v) }))}
        />
        {novo.tipo === "consumivel" && (
          <div className="field">
            <label>Observação (opcional)</label>
            <input
              type="text"
              value={novo.observacao}
              onChange={(e) => setNovo((p) => ({ ...p, observacao: e.target.value }))}
            />
          </div>
        )}
        <button className="btn primary" onClick={adicionar} disabled={salvandoNovo}>
          {salvandoNovo ? "Adicionando…" : "+ Adicionar material"}
        </button>
      </div>

      {carregando ? (
        <div className="panel"><div className="empty">Carregando…</div></div>
      ) : (
        <>
          <TabelaMateriais
            titulo="Filamentos"
            itens={filamentos}
            vazio="Nenhum filamento cadastrado ainda."
            comUnidade={false}
            edicoes={edicoes}
            setEdicoes={setEdicoes}
            onSalvarPreco={salvarPreco}
            onExcluir={setExcluirAlvo}
          />
          <TabelaMateriais
            titulo="Consumíveis"
            itens={consumiveis}
            vazio="Nenhum consumível cadastrado ainda — cola, lixa, tinta, o que mais gastar na fabricação."
            comUnidade
            edicoes={edicoes}
            setEdicoes={setEdicoes}
            onSalvarPreco={salvarPreco}
            onExcluir={setExcluirAlvo}
          />
          {materiais.length > 0 && (
            <div className="hint" style={{ marginTop: -6, marginBottom: 18 }}>
              Pra atualizar um preço: clique no valor, edite e aperte Enter (ou clique fora) para salvar. Filamentos aparecem no dropdown da aba Custo de Produção; consumíveis aparecem na seção "Consumíveis" da mesma aba.
            </div>
          )}
        </>
      )}

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir material"
          mensagem={`Confirma excluir "${excluirAlvo.nome}"? Não é possível desfazer.`}
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
