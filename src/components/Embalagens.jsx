import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import { arredondarPreco } from "../lib/format.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import CalculadoraPreco from "./CalculadoraPreco.jsx";

const VAZIO = { nome: "", preco: "", unidade: "un", observacao: "" };

// Fora do Embalagens() de propósito: se ficasse dentro, seria recriado a
// cada tecla digitada e o input perderia o foco a cada caractere.
function CampoPreco({ item, edicoes, setEdicoes, onSalvar }) {
  const [salvo, disparar] = useSalvoFlash();
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <input
        type="number"
        step="0.01"
        style={{ width: 90, textAlign: "right" }}
        value={edicoes[item.id] ?? arredondarPreco(item.preco)}
        onChange={(e) => setEdicoes((prev) => ({ ...prev, [item.id]: e.target.value }))}
        onBlur={async () => {
          if (edicoes[item.id] !== undefined && parseFloat(edicoes[item.id]) !== item.preco) {
            const ok = await onSalvar(item.id);
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

export default function Embalagens({ onToast }) {
  const { lojaId } = useLoja();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(VAZIO);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoes, setEdicoes] = useState({});
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [editItem, setEditItem] = useState(null); // embalagem sendo editada no menu, ou null
  const [edicaoForm, setEdicaoForm] = useState(VAZIO);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;

    async function carregar() {
      try {
        let query = supabase.from("embalagens").select("*").order("nome", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setItens(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();

    const canal = supabase
      .channel("embalagens-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "embalagens" }, carregar)
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  async function adicionar() {
    const nome = novo.nome.trim();
    const precoBruto = parseFloat(novo.preco);
    if (!nome || !isFinite(precoBruto)) {
      onToast("Preencha nome e preço");
      return;
    }
    setSalvandoNovo(true);
    const { error } = await supabase.from("embalagens").insert({
      nome,
      preco: arredondarPreco(precoBruto),
      unidade: novo.unidade.trim() || "un",
      observacao: novo.observacao.trim() || null,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvandoNovo(false);
    if (error) {
      onToast(`Não foi possível adicionar: ${error.message}`);
      return;
    }
    setNovo(VAZIO);
    onToast("Embalagem adicionada");
  }

  async function salvarPreco(id) {
    const valor = parseFloat(edicoes[id]);
    if (!isFinite(valor)) {
      onToast("Preço inválido");
      return false;
    }
    const { error } = await supabase
      .from("embalagens")
      .update({ preco: arredondarPreco(valor), atualizado_em: new Date().toISOString() })
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

  // Editar abre um menu (modal) com o item inteiro — nome, preço, unidade,
  // observação — pra ajustar sem excluir e recadastrar (o que deixaria dois
  // registros parecidos na lista, um deles esquecido desatualizado).
  function abrirEdicao(item) {
    setEdicaoForm({
      nome: item.nome,
      preco: String(arredondarPreco(item.preco)),
      unidade: item.unidade || "un",
      observacao: item.observacao || "",
    });
    setEditItem(item);
  }

  async function salvarEdicao() {
    const nome = edicaoForm.nome.trim();
    const precoBruto = parseFloat(edicaoForm.preco);
    if (!nome || !isFinite(precoBruto)) {
      onToast("Preencha nome e preço");
      return;
    }
    setSalvandoEdicao(true);
    const { error } = await supabase
      .from("embalagens")
      .update({
        nome,
        preco: arredondarPreco(precoBruto),
        unidade: edicaoForm.unidade.trim() || "un",
        observacao: edicaoForm.observacao.trim() || null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", editItem.id);
    setSalvandoEdicao(false);
    if (error) {
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    setEditItem(null);
    onToast("Embalagem atualizada");
  }

  // Antes de excluir, avisa se o item está em uso em alguma receita — pra
  // não sumir silenciosamente de um produto ou kit já montado (mesmo
  // problema que já mordeu a gente com loja sem aviso de PIN).
  async function pedirExclusao(item) {
    const [{ count: emProdutos }, { count: emKits }] = await Promise.all([
      supabase.from("produto_embalagens").select("id", { count: "exact", head: true }).eq("embalagem_id", item.id),
      supabase.from("kit_embalagens").select("id", { count: "exact", head: true }).eq("embalagem_id", item.id),
    ]);
    setExcluirAlvo({ ...item, emProdutos: emProdutos || 0, emKits: emKits || 0 });
  }

  async function excluir(id) {
    const { error } = await supabase.from("embalagens").delete().eq("id", id);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    setItens((prev) => prev.filter((m) => m.id !== id));
  }

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Embalagens</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  const usoMsg = (alvo) => {
    const partes = [];
    if (alvo.emProdutos) partes.push(`${alvo.emProdutos} produto(s)`);
    if (alvo.emKits) partes.push(`${alvo.emKits} kit(s)`);
    if (partes.length === 0) return `Confirma excluir "${alvo.nome}"? Não é possível desfazer.`;
    return `"${alvo.nome}" está em uso em ${partes.join(" e ")}. Excluir remove ela dessas receitas também. Não é possível desfazer.`;
  };

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">Adicionar embalagem</h3>
        <div className="row3">
          <div className="field">
            <label>Nome</label>
            <input
              type="text"
              placeholder="ex: Caixa 20x20x10"
              value={novo.nome}
              onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Preço por unidade (R$)</label>
            <input
              type="number"
              step="0.01"
              value={novo.preco}
              onChange={(e) => setNovo((p) => ({ ...p, preco: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Unidade (un, m...)</label>
            <input
              type="text"
              placeholder="un"
              value={novo.unidade}
              onChange={(e) => setNovo((p) => ({ ...p, unidade: e.target.value }))}
            />
          </div>
        </div>
        <CalculadoraPreco
          unidade={novo.unidade.trim() || "un"}
          onAplicar={(v) => setNovo((p) => ({ ...p, preco: String(v) }))}
        />
        <div className="field">
          <label>Observação (opcional)</label>
          <input
            type="text"
            value={novo.observacao}
            onChange={(e) => setNovo((p) => ({ ...p, observacao: e.target.value }))}
          />
        </div>
        <button className="btn primary" onClick={adicionar} disabled={salvandoNovo}>
          {salvandoNovo ? "Adicionando…" : "+ Adicionar embalagem"}
        </button>
      </div>

      <div className="panel">
        <h3>Embalagens cadastradas</h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : itens.length === 0 ? (
          <div className="empty">Nenhuma embalagem cadastrada ainda — caixa, plástico bolha, envelope, mimo...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th className="num">Preço</th>
                  <th>Unidade</th>
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
                      <CampoPreco item={m} edicoes={edicoes} setEdicoes={setEdicoes} onSalvar={salvarPreco} />
                    </td>
                    <td>{m.unidade || "un"}</td>
                    <td>{m.observacao || "—"}</td>
                    <td>{new Date(m.atualizado_em).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <button className="del" title="Editar" onClick={() => abrirEdicao(m)}>✎</button>
                      <button className="del" title="Excluir" onClick={() => pedirExclusao(m)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {itens.length > 0 && (
          <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            Esses itens aparecem na ficha do Produto (seção "Itens de embalagem") e na montagem de Kits.
          </div>
        )}
      </div>

      {excluirAlvo && (
        <ConfirmDialog
          titulo="Excluir embalagem"
          mensagem={usoMsg(excluirAlvo)}
          confirmarLabel="Excluir"
          perigo
          onConfirm={() => {
            excluir(excluirAlvo.id);
            setExcluirAlvo(null);
          }}
          onCancel={() => setExcluirAlvo(null)}
        />
      )}

      {editItem && (
        <EditarDialog titulo="Editar embalagem" salvando={salvandoEdicao} onSalvar={salvarEdicao} onCancelar={() => setEditItem(null)}>
          <div className="row3">
            <div className="field">
              <label>Nome</label>
              <input
                type="text"
                value={edicaoForm.nome}
                onChange={(e) => setEdicaoForm((p) => ({ ...p, nome: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Preço por unidade (R$)</label>
              <input
                type="number"
                step="0.01"
                value={edicaoForm.preco}
                onChange={(e) => setEdicaoForm((p) => ({ ...p, preco: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Unidade (un, m...)</label>
              <input
                type="text"
                value={edicaoForm.unidade}
                onChange={(e) => setEdicaoForm((p) => ({ ...p, unidade: e.target.value }))}
              />
            </div>
          </div>
          <CalculadoraPreco
            unidade={edicaoForm.unidade.trim() || "un"}
            onAplicar={(v) => setEdicaoForm((p) => ({ ...p, preco: String(v) }))}
          />
          <div className="field">
            <label>Observação (opcional)</label>
            <input
              type="text"
              value={edicaoForm.observacao}
              onChange={(e) => setEdicaoForm((p) => ({ ...p, observacao: e.target.value }))}
            />
          </div>
        </EditarDialog>
      )}
    </div>
  );
}
