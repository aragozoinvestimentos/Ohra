import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import { arredondarPreco, DATA } from "../lib/format.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";
import CalculadoraPreco from "./CalculadoraPreco.jsx";
import CompraMaterialDialog from "./CompraMaterialDialog.jsx";
import { precoMedio } from "../lib/comprasMaterial.js";

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
        value={edicoes[material.id] ?? arredondarPreco(material.preco)}
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

function TabelaMateriais({ titulo, itens, vazio, comUnidade, edicoes, setEdicoes, onSalvarPreco, onEditar, onExcluir, onCompra, compras }) {
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
                    {(() => {
                      const media = precoMedio(compras.filter((c) => c.material_id === m.id));
                      return media ? (
                        <div className="hint" style={{ margin: "2px 0 0", fontSize: "0.82em" }} title="Preço = média ponderada das últimas compras que contam. Editar o valor na mão vale até a próxima compra.">
                          média de {media.compras} compra{media.compras > 1 ? "s" : ""}
                        </div>
                      ) : null;
                    })()}
                  </td>
                  {comUnidade && <td>{m.unidade || "un"}</td>}
                  <td>{m.observacao || "—"}</td>
                  <td>{DATA(m.atualizado_em)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-mini" title="Registrar compra deste material (atualiza o preço pela média e lança a saída no caixa)" onClick={() => onCompra(m)}>
                      + Compra
                    </button>{" "}
                    <button className="del" title="Editar" onClick={() => onEditar(m)}>✎</button>
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
  // Materiais vêm do store único do catálogo (mesma lista, ao vivo, que o
  // resto do app usa); depois de gravar, pede uma recarga.
  const { materiais, carregando } = useRankingData();
  const [novo, setNovo] = useState(VAZIO);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [edicoes, setEdicoes] = useState({}); // id -> valor em edição (preco como string)
  const [excluirAlvo, setExcluirAlvo] = useState(null);
  const [editItem, setEditItem] = useState(null); // material sendo editado no menu, ou null
  const [edicaoForm, setEdicaoForm] = useState(VAZIO);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [compraAlvo, setCompraAlvo] = useState(null); // { materialId } com a janela de compra aberta
  const [compras, setCompras] = useState([]);

  // Compras registradas (schema v32) — só pra mostrar "média de N compras";
  // sem a tabela, fica vazio e nada muda.
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      try {
        let q = supabase.from("compras_material").select("id, material_id, data, quantidade, valor_total, contar_media, criado_em");
        if (lojaId) q = q.eq("loja_id", lojaId);
        const { data, error } = await q;
        if (ativo && !error) setCompras(data || []);
      } catch {
        // sem rede/tabela — segue sem a média
      }
    }
    carregar();
    const ch = supabase
      .channel("compras-material-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "compras_material" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(ch);
    };
  }, [lojaId]);

  async function adicionar() {
    const nome = novo.nome.trim();
    const precoBruto = parseFloat(novo.preco);
    if (!nome || !isFinite(precoBruto)) {
      onToast("Preencha nome e preço");
      return;
    }
    if (precoBruto <= 0) {
      onToast("Preço deve ser maior que zero");
      return;
    }
    setSalvandoNovo(true);
    const { error } = await supabase.from("materiais").insert({
      nome,
      preco: arredondarPreco(precoBruto),
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
    recarregarCatalogo();
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
    recarregarCatalogo();
    return true;
  }

  // Editar abre um menu (modal) com o item inteiro pra ajustar — nome,
  // unidade, tipo, observação — sem precisar excluir e cadastrar de novo
  // (o que deixaria dois registros parecidos na lista, um deles esquecido
  // desatualizado).
  function abrirEdicao(m) {
    setEdicaoForm({
      nome: m.nome,
      preco: String(arredondarPreco(m.preco)),
      unidade: m.unidade || "un",
      tipo: m.tipo || "filamento",
      observacao: m.observacao || "",
    });
    setEditItem(m);
  }

  async function salvarEdicao() {
    const nome = edicaoForm.nome.trim();
    const precoBruto = parseFloat(edicaoForm.preco);
    if (!nome || !isFinite(precoBruto)) {
      onToast("Preencha nome e preço");
      return;
    }
    if (precoBruto <= 0) {
      onToast("Preço deve ser maior que zero");
      return;
    }
    setSalvandoEdicao(true);
    const nomeAntigo = editItem.nome;
    const { error } = await supabase
      .from("materiais")
      .update({
        nome,
        preco: arredondarPreco(precoBruto),
        unidade: edicaoForm.tipo === "filamento" ? "kg" : edicaoForm.unidade.trim() || "un",
        tipo: edicaoForm.tipo,
        observacao: edicaoForm.observacao.trim() || null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", editItem.id);
    if (error) {
      setSalvandoEdicao(false);
      onToast(`Não foi possível salvar: ${error.message}`);
      return;
    }
    // Renomeou? Produtos e variações acham o filamento pelo NOME — atualiza
    // todos que usavam o nome antigo, senão eles passariam a calcular com
    // outro filamento da lista sem avisar.
    let atualizados = 0;
    if (nome !== nomeAntigo) {
      try {
        atualizados = await renomearNosProdutos(nomeAntigo, nome, editItem.id);
      } catch (e) {
        onToast(`Material renomeado, mas falhou ao atualizar os produtos: ${e.message}`);
      }
    }
    setSalvandoEdicao(false);
    setEditItem(null);
    recarregarCatalogo();
    onToast(atualizados ? `Material atualizado · ${atualizados} produto(s)/variação(ões) passaram pro nome novo` : "Material atualizado");
  }

  async function renomearNosProdutos(antigo, novo, materialId) {
    let n = 0;
    let qp = supabase.from("produtos_cadastro").select("id, material_nome, material_id, producao_detalhe");
    if (lojaId) qp = qp.eq("loja_id", lojaId);
    const { data: prods, error: e1 } = await qp;
    if (e1) throw e1;
    for (const p of prods || []) {
      const usaNome = p.material_nome === antigo;
      const usaDetalhe = p.producao_detalhe?.materialNome === antigo;
      if (!usaNome && !usaDetalhe) continue;
      const upd = {};
      if (usaNome) {
        upd.material_nome = novo;
        if (!p.material_id) upd.material_id = materialId;
      }
      if (usaDetalhe) upd.producao_detalhe = { ...p.producao_detalhe, materialNome: novo };
      const { error } = await supabase.from("produtos_cadastro").update(upd).eq("id", p.id);
      if (error) throw error;
      n++;
    }
    let qv = supabase.from("produto_variacoes").select("id, producao_detalhe");
    if (lojaId) qv = qv.eq("loja_id", lojaId);
    const { data: vars, error: e2 } = await qv;
    if (!e2) {
      for (const v of vars || []) {
        if (v.producao_detalhe?.materialNome !== antigo) continue;
        const { error } = await supabase.from("produto_variacoes").update({ producao_detalhe: { ...v.producao_detalhe, materialNome: novo } }).eq("id", v.id);
        if (error) throw error;
        n++;
      }
    }
    return n;
  }

  // Antes de excluir, confere se o material está em uso em algum produto
  // cadastrado (material é referenciado por nome em produtos_cadastro.material_nome,
  // não por id) — mesma ideia do aviso de uso que Embalagens já faz, mas aqui
  // bloqueia mesmo a exclusão, já que sumir o material de baixo de um produto
  // já cadastrado quebraria o cálculo de custo dele silenciosamente.
  async function pedirExclusao(item) {
    const { count } = await supabase
      .from("produtos_cadastro")
      .select("id", { count: "exact", head: true })
      .eq("material_nome", item.nome);
    if (count) {
      onToast(`"${item.nome}" está em uso em ${count} produto(s). Não é possível excluir enquanto estiver em uso.`);
      return;
    }
    setExcluirAlvo(item);
  }

  async function excluir(id) {
    const { error } = await supabase.from("materiais").delete().eq("id", id);
    if (error) {
      onToast(`Não foi possível excluir: ${error.message}`);
      return;
    }
    recarregarCatalogo();
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
        <h3 className="section-title">
          <span>
            Adicionar material
            <Ajuda texto="Cadastre cada TIPO de material uma vez (PLA comum, PLA Silk, PETG…). Comprou? Use “+ Compra” na linha (ou “Registrar compra” aqui): o preço/kg vira a média ponderada das 3 últimas compras e a saída entra sozinha no Fluxo de Caixa. Dá pra editar o preço na mão clicando no valor (vale até a próxima compra). Filamentos aparecem no Custo de Produção; consumíveis na seção “Consumíveis” da mesma aba." />
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setCompraAlvo({ materialId: "" })} disabled={!materiais.length}>
            + Registrar compra
          </button>
        </h3>
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
              min="0"
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
            onEditar={abrirEdicao}
            onExcluir={pedirExclusao}
            onCompra={(m) => setCompraAlvo({ materialId: m.id })}
            compras={compras}
          />
          <TabelaMateriais
            titulo="Consumíveis"
            itens={consumiveis}
            vazio="Nenhum consumível cadastrado ainda — cola, lixa, tinta, o que mais gastar na fabricação."
            comUnidade
            edicoes={edicoes}
            setEdicoes={setEdicoes}
            onSalvarPreco={salvarPreco}
            onEditar={abrirEdicao}
            onExcluir={pedirExclusao}
            onCompra={(m) => setCompraAlvo({ materialId: m.id })}
            compras={compras}
          />
        </>
      )}

      {compraAlvo && (
        <CompraMaterialDialog materialIdInicial={compraAlvo.materialId} onToast={onToast} onClose={() => setCompraAlvo(null)} />
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

      {editItem && (
        <EditarDialog
          titulo={`Editar ${editItem.tipo === "consumivel" ? "consumível" : "filamento"}`}
          salvando={salvandoEdicao}
          onSalvar={salvarEdicao}
          onCancelar={() => setEditItem(null)}
        >
          <div className="field">
            <label>Tipo</label>
            <select value={edicaoForm.tipo} onChange={(e) => setEdicaoForm((p) => ({ ...p, tipo: e.target.value }))}>
              <option value="filamento">Filamento (preço por kg)</option>
              <option value="consumivel">Consumível — cola, lixa, tinta... (preço por unidade)</option>
            </select>
          </div>
          <div className="field">
            <label>Nome</label>
            <input
              type="text"
              value={edicaoForm.nome}
              onChange={(e) => setEdicaoForm((p) => ({ ...p, nome: e.target.value }))}
            />
          </div>
          <div className="row2">
            <div className="field">
              <label>{edicaoForm.tipo === "filamento" ? "Preço por kg (R$)" : "Preço por unidade (R$)"}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={edicaoForm.preco}
                onChange={(e) => setEdicaoForm((p) => ({ ...p, preco: e.target.value }))}
              />
            </div>
            {edicaoForm.tipo === "consumivel" && (
              <div className="field">
                <label>Unidade (un, ml, g...)</label>
                <input
                  type="text"
                  value={edicaoForm.unidade}
                  onChange={(e) => setEdicaoForm((p) => ({ ...p, unidade: e.target.value }))}
                />
              </div>
            )}
          </div>
          <CalculadoraPreco
            unidade={edicaoForm.tipo === "filamento" ? "kg" : edicaoForm.unidade.trim() || "un"}
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
