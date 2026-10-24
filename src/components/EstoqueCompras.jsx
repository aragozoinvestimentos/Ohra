import { useEffect, useMemo, useRef, useState } from "react";
import { trocarSubAba, useSubAba } from "../lib/subAbas.js";
import { pegarPedido } from "../lib/navegar.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEstoque } from "../hooks/useEstoque.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import Kpis from "./Kpis.jsx";
import Estado from "./Estado.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import { BRL } from "../lib/format.js";
import { ALIQUOTA_INTERNA_PADRAO, compraDeForaDoEstado, custoDosItens, diferencasInventario, palpiteFator, ehRevenda, extratoEstoque, ligarItem, lerNfe } from "../lib/revenda.js";
import { ajustarEstoque, excluirFornecedor, excluirMovimento, excluirNota, gravarInventario, gravarNota, salvarEstoqueCfg, salvarFornecedor, SQL_REVENDA } from "../lib/revendaAcoes.js";

// Operação → Estoque e compras (REVENDA, schema v66, 24/10/2026). O estoque de cada
// produto de revenda começa na 1ª nota importada (XML), sai sozinho pelos pedidos
// importados da Olist e só tem ajuste à mão nas exceções e no inventário.
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const fq = (q) => (Number.isInteger(q) ? String(q) : Number(q).toFixed(1).replace(".", ","));
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const TOM = { negativo: "resolver", zerado: "atencao", repor: "atencao", parado: "info", ok: null, "sem-controle": "info" };

export default function EstoqueCompras({ onToast }) {
  const [sub] = useSubAba("ohra:estoque-sub", "estoque", ["estoque", "notas", "fornecedores", "inventario"]);
  const est = useEstoque();
  // Pedido de outra tela (Início, cadastro): { sub } abre a sub-aba certa.
  useEffect(() => {
    const aplicar = () => {
      const p = pegarPedido("estoque");
      if (p?.sub) trocarSubAba("ohra:estoque-sub", p.sub);
    };
    aplicar();
    const ouvir = (e) => e.detail?.aba === "estoque" && aplicar();
    window.addEventListener("ohra:ir-para", ouvir);
    return () => window.removeEventListener("ohra:ir-para", ouvir);
  }, []);
  if (!est.carregando && !est.disponivel)
    return (
      <div className="panel">
        <div className="alerta alerta-warn">
          <b>Falta o SQL da revenda</b>
          {SQL_REVENDA}.
        </div>
      </div>
    );
  if (sub === "notas") return <Notas est={est} onToast={onToast} />;
  if (sub === "fornecedores") return <Fornecedores est={est} onToast={onToast} />;
  if (sub === "inventario") return <Inventario est={est} onToast={onToast} />;
  return <Estoque est={est} onToast={onToast} />;
}

// ---------------------------------------------------------------- Estoque
function Estoque({ est, onToast }) {
  const { lojaId } = useLoja();
  const { linhas, hoje } = est;
  const [aberto, setAberto] = useState(null);
  const [ajuste, setAjuste] = useState(null);
  const [cfgEdit, setCfgEdit] = useState(null);
  const [apagar, setApagar] = useState(null);
  const controladas = linhas.filter((l) => !l.est.semControle);
  const valor = controladas.reduce((s, l) => s + l.valor, 0);
  const unidades = controladas.reduce((s, l) => s + Math.max(0, l.est.saldo), 0);
  const repor = linhas.filter((l) => ["repor", "zerado", "negativo"].includes(l.sit.tipo));
  const parados = linhas.filter((l) => l.sit.tipo === "parado");
  const custoDia = controladas.reduce((s, l) => s + l.est.porDia * l.custo, 0);
  const giro = custoDia > 0 ? Math.round(valor / custoDia) : null;

  if (!linhas.length)
    return (
      <div className="panel">
        <h3>Estoque</h3>
        <div className="empty">
          Nenhum produto de revenda ainda. Comece em <b>Notas de compra → Importar nota (XML)</b>: cada item da nota vira (ou se liga a) um produto de revenda, e o estoque começa ali. Também dá pra marcar um produto como "Revenda" em Cadastro de produtos.
        </div>
      </div>
    );

  return (
    <>
      <Kpis
        itens={[
          { label: "Dinheiro em estoque", valor: BRL(valor), sub: `pelo custo médio · ${fq(unidades)} un` },
          { label: "Repor", valor: `${repor.length} ${repor.length === 1 ? "item" : "itens"}`, sub: "acabam antes do prazo do fornecedor", tom: repor.length ? "warn" : null },
          { label: "Parado", valor: BRL(parados.reduce((s, l) => s + l.valor, 0)), sub: `${parados.length} sem venda há 30+ dias` },
          { label: "Giro", valor: giro != null ? `~${giro} dias` : "—", sub: "tempo médio pra vender o estoque" },
        ]}
      />
      <div className="panel">
        <h3>Produtos de revenda</h3>
        <p className="hint">
          Entra pela nota (XML) e sai pelos pedidos importados da Olist — pago baixa, cancelado/devolvido volta. Atualizado até o último arquivo de pedidos que você subiu.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Em estoque</th>
                <th>Vende/dia</th>
                <th>Dura</th>
                <th>Prazo forn.</th>
                <th>Custo médio</th>
                <th>Valor</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <LinhaEstoque key={l.produto.id} l={l} aberto={aberto === l.produto.id} onClick={() => setAberto(aberto === l.produto.id ? null : l.produto.id)} onAjustar={() => setAjuste({ produto: l.produto, qtd: "", sinal: "-", motivo: "Perda / quebra", data: hoje })} onCfg={() => setCfgEdit({ produto: l.produto, prazo: String(l.sit.prazo), folga: String(l.sit.folga) })} onApagar={setApagar} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {ajuste && (
        <EditarDialog
          titulo={`Ajustar estoque — ${ajuste.produto.nome}`}
          salvarLabel="Registrar ajuste"
          onCancelar={() => setAjuste(null)}
          onSalvar={async () => {
            const q = num(ajuste.qtd) * (ajuste.sinal === "-" ? -1 : 1);
            if (!q) return onToast?.("Digite a quantidade");
            const r = await ajustarEstoque({ lojaId, produtoId: ajuste.produto.id, quantidade: q, motivo: ajuste.motivo, data: ajuste.data });
            onToast?.(r.error ? r.error.message : "Ajuste registrado");
            if (!r.error) setAjuste(null);
          }}
        >
          <p className="hint">Só pras exceções: o que entra pela nota e sai pelos pedidos o app já conta sozinho.</p>
          <div className="grid-auto">
            <label>
              Saiu ou entrou?
              <select value={ajuste.sinal} onChange={(e) => setAjuste({ ...ajuste, sinal: e.target.value })}>
                <option value="-">Saiu (−)</option>
                <option value="+">Entrou (+)</option>
              </select>
            </label>
            <label>
              Quantidade (un)
              <input inputMode="decimal" value={ajuste.qtd} onChange={(e) => setAjuste({ ...ajuste, qtd: e.target.value })} />
            </label>
            <label>
              Motivo
              <select value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })}>
                {["Perda / quebra", "Brinde", "Amostra pra afiliado", "Uso próprio", "Venda fora dos marketplaces", "Devolução que não voltou no app", "Outro"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              Data
              <input type="date" value={ajuste.data} onChange={(e) => setAjuste({ ...ajuste, data: e.target.value })} />
            </label>
          </div>
        </EditarDialog>
      )}
      {cfgEdit && (
        <EditarDialog
          titulo={`Quando avisar pra repor — ${cfgEdit.produto.nome}`}
          onCancelar={() => setCfgEdit(null)}
          onSalvar={async () => {
            const r = await salvarEstoqueCfg(cfgEdit.produto.id, { prazo: num(cfgEdit.prazo) || null, folga: cfgEdit.folga === "" ? null : num(cfgEdit.folga) });
            onToast?.(r.error ? r.error.message : "Salvo");
            if (!r.error) setCfgEdit(null);
          }}
        >
          <div className="grid-auto">
            <label>
              Prazo do fornecedor (dias)
              <input inputMode="numeric" value={cfgEdit.prazo} onChange={(e) => setCfgEdit({ ...cfgEdit, prazo: e.target.value })} />
            </label>
            <label>
              Folga (dias a mais)
              <input inputMode="numeric" value={cfgEdit.folga} onChange={(e) => setCfgEdit({ ...cfgEdit, folga: e.target.value })} />
            </label>
          </div>
          <p className="hint">Avisa "repor" quando o estoque durar menos que prazo + folga. Sugestão de compra = o que cobre o prazo + 30 dias de venda.</p>
        </EditarDialog>
      )}
      {apagar && (
        <ConfirmDialog
          titulo="Apagar este ajuste?"
          mensagem={`${dm(apagar.data)} · ${apagar.motivo || apagar.tipo} · ${fq(apagar.q)} un. O estoque volta a contar sem ele.`}
          confirmarLabel="Apagar"
          perigo
          onCancel={() => setApagar(null)}
          onConfirm={async () => {
            const r = await excluirMovimento(apagar.id);
            onToast?.(r.error ? r.error.message : "Ajuste apagado");
            setApagar(null);
          }}
        />
      )}
    </>
  );
}

function LinhaEstoque({ l, aberto, onClick, onAjustar, onCfg, onApagar }) {
  const { produto: p, est: e, sit } = l;
  const extrato = useMemo(() => (aberto ? extratoEstoque({ movimentos: l.movimentos, vendas: l.vendas, inicio: e.inicio }) : []), [aberto, l.movimentos, l.vendas, e.inicio]);
  return (
    <>
      <tr className="linha-clicavel" onClick={onClick} style={{ cursor: "pointer" }}>
        <td>
          <b>{p.nome}</b>
          <div className="muted-cel">{[p.sku, l.fornecedor?.nome].filter(Boolean).join(" · ")}</div>
        </td>
        <td>{e.semControle ? "—" : `${fq(e.saldo)} un`}</td>
        <td>{e.porDia ? e.porDia.toFixed(1).replace(".", ",") : "0"}</td>
        <td>{e.duraDias != null ? `~${Math.floor(e.duraDias)} dias` : "—"}</td>
        <td>{sit.prazo} dias</td>
        <td>{BRL(l.custo)}</td>
        <td>{e.semControle ? "—" : BRL(l.valor)}</td>
        <td>{sit.tipo === "ok" ? <span className="muted-cel">✓ ok</span> : <Estado tipo={TOM[sit.tipo] || "info"}>{sit.texto}</Estado>}</td>
      </tr>
      {aberto && (
        <tr className="linha-detalhe">
          <td colSpan={8}>
            <div className="detalhe-cel">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <b>Movimentos{e.inicio ? ` desde ${dmy(e.inicio)} (1ª nota)` : ""}</b>
                <button type="button" className="btn btn-mini" onClick={onAjustar}>
                  ± Ajustar (perda, brinde, amostra…)
                </button>
                <button type="button" className="btn btn-mini" onClick={onCfg}>
                  Quando avisar pra repor
                </button>
              </div>
              {e.negativoEm && (
                <div className="alerta alerta-bad">
                  <b>! Estoque ficou negativo em {dm(e.negativoEm)}</b>
                  Vendeu mais do que tinha entrado — normalmente é nota ainda não importada ou contagem errada. Importe a nota que falta ou faça o inventário. O app não bloqueia a venda (o pedido já aconteceu), só avisa.
                </div>
              )}
              {extrato.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>O quê</th>
                      <th>De onde veio</th>
                      <th>Qtd</th>
                      <th>Saldo</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {extrato.map((x, i) => (
                      <tr key={x.id || `${x.data}-${i}`}>
                        <td>{dm(x.data)}</td>
                        <td>{x.tipo === "entrada" ? "Entrada — compra" : x.tipo === "venda" ? "Venda" : x.tipo === "inventario" ? "Inventário" : "Ajuste"}</td>
                        <td>{x.tipo === "venda" ? `${x.pedidos} pedido${x.pedidos === 1 ? "" : "s"} importado${x.pedidos === 1 ? "" : "s"}` : x.motivo || "—"}</td>
                        <td style={{ color: x.q > 0 ? "var(--good)" : undefined, fontWeight: x.q > 0 ? 700 : undefined }}>{x.q > 0 ? `+${fq(x.q)}` : fq(x.q)}</td>
                        <td style={{ color: x.saldo < 0 ? "var(--bad)" : undefined }}>{fq(x.saldo)}</td>
                        <td>
                          {(x.tipo === "ajuste" || x.tipo === "inventario") && (
                            <button type="button" className="link-btn" onClick={() => onApagar(x)} title="Apagar este ajuste">
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted-cel">Sem movimentos — importe uma nota de compra com este produto.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Notas
function Notas({ est, onToast }) {
  const [importando, setImportando] = useState(null);
  const [apagar, setApagar] = useState(null);
  const arquivo = useRef(null);
  const notas = [...est.compras].sort((a, b) => String(b.emissao).localeCompare(String(a.emissao)));
  async function escolher(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const nota = lerNfe(await f.text());
    if (nota.erro) return onToast?.(nota.erro);
    if (nota.chave && est.compras.some((c) => c.chave_nfe === nota.chave)) return onToast?.(`A NF ${nota.numero} já foi importada — não entra duas vezes.`);
    setImportando(nota);
  }
  if (importando) return <ImportarNota nota={importando} est={est} onToast={onToast} onFechar={() => setImportando(null)} />;
  return (
    <>
      <div className="panel">
        <h3>Notas de compra</h3>
        <div className="toolbar">
          <input ref={arquivo} type="file" accept=".xml,text/xml,application/xml" hidden onChange={escolher} />
          <button type="button" className="btn primary" onClick={() => arquivo.current?.click()}>
            📄 Importar nota (XML)
          </button>
          <span className="hint" style={{ margin: 0 }}>
            O XML da NF-e vem no e-mail do fornecedor ou no site dele. Cada nota: entra no estoque, atualiza o custo médio e lança as parcelas no Caixa.
          </span>
        </div>
        {notas.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Emissão</th>
                  <th>Nota</th>
                  <th>Fornecedor</th>
                  <th>Itens</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {notas.map((c) => {
                  const its = est.comprasItens.filter((i) => i.compra_id === c.id);
                  const forn = est.fornecedores.find((f) => f.id === c.fornecedor_id);
                  return (
                    <tr key={c.id}>
                      <td>{dmy(c.emissao)}</td>
                      <td>
                        NF {c.numero}
                        {c.contar_media === false && <div className="muted-cel">fora da média</div>}
                      </td>
                      <td>{forn?.nome || "—"}</td>
                      <td>
                        {its.length} · {fq(its.reduce((s, i) => s + num(i.quantidade), 0))} un
                      </td>
                      <td>
                        {BRL(c.total_nota)}
                        {num(c.difal) > 0 && <div className="muted-cel">+ DIFAL {BRL(c.difal)}</div>}
                      </td>
                      <td>
                        <button type="button" className="link-btn" onClick={() => setApagar(c)} title="Excluir a nota">
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Nenhuma nota ainda. O estoque de cada produto começa na 1ª nota importada.</div>
        )}
      </div>
      {apagar && (
        <ConfirmDialog
          titulo={`Excluir a NF ${apagar.numero}?`}
          mensagem="As entradas dela saem do estoque, o custo médio é recalculado sem ela e as parcelas EM ABERTO saem do Caixa (as já pagas ficam)."
          confirmarLabel="Excluir nota"
          perigo
          onCancel={() => setApagar(null)}
          onConfirm={async () => {
            const r = await excluirNota(apagar, est.comprasItens);
            onToast?.(r.error ? r.error.message : "Nota excluída");
            setApagar(null);
          }}
        />
      )}
    </>
  );
}

function ImportarNota({ nota, est, onToast, onFechar }) {
  const { lojaId } = useLoja();
  const { produtos } = useRankingData();
  const [pagoComPref, setPagoComPref] = usePreferencia("caixa:pago-com", "bolso");
  const fornecedor = est.fornecedores.find((f) => String(f.cnpj || "").replace(/\D/g, "") === nota.emitente.cnpj) || null;
  const fora = compraDeForaDoEstado(nota);
  const [ligacoes, setLigacoes] = useState(() =>
    Object.fromEntries(
      nota.itens.map((i) => {
        const l = ligarItem(i, { fornecedorId: fornecedor?.id, fornecedorItens: est.fornecedorItens, produtos });
        const palpite = l.por === "codigo" ? null : palpiteFator(i);
        return [i.n, { produtoId: l.produtoId || "", fator: String(palpite || l.fator), palpite: !!palpite, por: l.por, nome: tituloBonito(i.descricao) }];
      })
    )
  );
  const [difal, setDifal] = useState({ ligado: fora, aliquotaInterna: String(ALIQUOTA_INTERNA_PADRAO * 100) });
  const [contarMedia, setContarMedia] = useState(true);
  const [jaPaga, setJaPaga] = useState(false);
  const [pagoCom, setPagoCom] = useState(pagoComPref || "bolso");
  const [salvando, setSalvando] = useState(false);
  const fatores = Object.fromEntries(Object.entries(ligacoes).map(([n, l]) => [n, num(l.fator) || 1]));
  const calc = custoDosItens(nota, { fatores, difal: { ligado: difal.ligado, aliquotaInterna: num(difal.aliquotaInterna) / 100 } });
  const faltam = calc.filter((c) => !ligacoes[c.n]?.produtoId).length;
  const revendaP = produtos.filter(ehRevenda);
  const outrosP = produtos.filter((p) => !ehRevenda(p));
  const set = (n, campos) => setLigacoes((x) => ({ ...x, [n]: { ...x[n], ...campos } }));
  const custoAtual = (pid) => num(produtos.find((p) => p.id === pid)?.custo_producao);
  const temMedia = (pid) => est.comprasItens.some((i) => i.produto_id === pid);
  const parcelas = nota.duplicatas.map((d) => ({ venc: d.venc, valor: d.valor }));

  async function gravar() {
    setSalvando(true);
    const linhas = calc.map((c) => {
      const lg = ligacoes[c.n];
      const pid = lg?.produtoId;
      return { ...c, produtoId: pid || null, produtoTemEan: !!produtos.find((p) => p.id === pid)?.ean };
    });
    const novos = linhas.filter((l) => l.produtoId === "novo").map((l) => ({ chave: l.n, nome: ligacoes[l.n].nome || l.descricao, ean: l.ean, custo: l.custoUn }));
    const r = await gravarNota({ lojaId, nota, linhas, fornecedores: est.fornecedores, difal: { ligado: difal.ligado, aliquotaInterna: num(difal.aliquotaInterna) / 100 }, contarMedia, caixa: { pagoCom, jaPaga: jaPaga && !parcelas.length, parcelas }, novosProdutos: novos });
    setSalvando(false);
    if (r.error) return onToast?.(r.error.message);
    setPagoComPref(pagoCom);
    onToast?.(r.avisoCaixa || `NF ${nota.numero} gravada: ${r.itens} ${r.itens === 1 ? "item" : "itens"} no estoque${novos.length ? ` · ${novos.length} produto(s) novo(s) — complete SKU, peso e embalagem em Cadastro de produtos` : ""}`);
    onFechar();
  }

  return (
    <>
      <div className="panel">
        <h3>Importar nota de compra — NF {nota.numero}</h3>
        <div className="grid-cards">
          <div className="kv-cel">
            <span>Fornecedor</span>
            <b>{nota.emitente.nome}</b>
            <span className="muted-cel">
              {nota.emitente.cnpj ? `CNPJ ${nota.emitente.cnpj}` : ""} · {nota.emitente.uf || "—"} {fornecedor ? "· já cadastrado" : "· será cadastrado"}
            </span>
          </div>
          <div className="kv-cel">
            <span>Nota</span>
            <b>
              NF {nota.numero} · série {nota.serie || "—"}
            </b>
            <span className="muted-cel">emitida {dmy(nota.emissao)}</span>
          </div>
          <div className="kv-cel">
            <span>Total da nota</span>
            <b>{BRL(nota.totais.vNF)}</b>
            <span className="muted-cel">
              produtos {BRL(nota.totais.vProd)} · IPI {BRL(nota.totais.vIPI)} · ST {BRL(nota.totais.vST)} · frete {BRL(nota.totais.vFrete)}
            </span>
          </div>
          <div className="kv-cel">
            <span>Compra de fora do estado?</span>
            <b>{fora ? `Sim (${nota.emitente.uf} → ${nota.ufDestino})` : `Não${nota.emitente.uf ? ` (${nota.emitente.uf} → ${nota.ufDestino || nota.emitente.uf})` : ""}`}</b>
            {fora && (
              <label className="check-inline">
                <input type="checkbox" checked={difal.ligado} onChange={(e) => setDifal({ ...difal, ligado: e.target.checked })} /> somar DIFAL no custo (alíquota interna{" "}
                <input style={{ width: 52 }} inputMode="decimal" value={difal.aliquotaInterna} onChange={(e) => setDifal({ ...difal, aliquotaInterna: e.target.value })} />
                %)
              </label>
            )}
          </div>
        </div>
        {fora && <p className="hint">DIFAL na base única, como a sua planilha (preço × alíquota interna − ICMS da nota; item com ST não paga). Confirme com o contador se a sua empresa paga.</p>}
        {faltam > 0 && (
          <div className="alerta alerta-warn">
            <b>
              {faltam} {faltam === 1 ? "item novo" : "itens novos"} — diga uma vez a qual produto é. Nas próximas notas desse fornecedor o app já sabe.
            </b>
            Liga sozinho pelo EAN quando a nota traz. Se vem em caixa/pacote, diga quantas unidades vêm em cada uma (também fica guardado).
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item na nota</th>
                <th>É o produto</th>
                <th>Na nota</th>
                <th>Un. em cada</th>
                <th>Entra no estoque</th>
                <th>Preço un.</th>
                <th>+ impostos e frete / un</th>
                <th>Custo final / un</th>
                <th>Custo médio</th>
              </tr>
            </thead>
            <tbody>
              {calc.map((c) => {
                const lg = ligacoes[c.n];
                return (
                  <tr key={c.n} style={!lg.produtoId ? { background: "var(--warn-soft)" } : undefined}>
                    <td>
                      <b>{c.descricao}</b>
                      <div className="muted-cel">
                        cód. {c.codigo || "—"} · {c.ean ? `EAN ${c.ean}` : "sem EAN"}
                      </div>
                    </td>
                    <td>
                      <select value={lg.produtoId} onChange={(e) => set(c.n, { produtoId: e.target.value, por: null })}>
                        <option value="">Escolher produto…</option>
                        <option value="novo">+ Cadastrar como produto novo (revenda)</option>
                        {revendaP.length > 0 && (
                          <optgroup label="Revenda">
                            {revendaP.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {outrosP.length > 0 && (
                          <optgroup label="Outros produtos (passam a ser revenda)">
                            {outrosP.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {lg.produtoId === "novo" && <input style={{ marginTop: 4, width: "100%" }} value={lg.nome} onChange={(e) => set(c.n, { nome: e.target.value })} placeholder="Nome do produto" />}
                      {lg.por === "ean" && <div className="muted-cel" style={{ color: "var(--good)" }}>✓ pelo EAN</div>}
                      {lg.por === "codigo" && <div className="muted-cel" style={{ color: "var(--good)" }}>✓ ligado antes</div>}
                    </td>
                    <td>
                      {fq(c.qtd)} {c.unidade}
                    </td>
                    <td>
                      <input style={{ width: 56 }} inputMode="numeric" value={lg.fator} onChange={(e) => set(c.n, { fator: e.target.value, palpite: false })} />
                      {lg.palpite && <div className="muted-cel" style={{ color: "var(--warn)" }}>lido da nota — confira</div>}
                    </td>
                    <td>{fq(c.quantidade)} un</td>
                    <td>{BRL(c.precoUn)}</td>
                    <td>
                      {BRL(c.ipiUn + c.stUn + c.freteUn + c.difalUn)}
                      <div className="muted-cel">
                        {[c.ipiUn > 0 && `IPI ${BRL(c.ipiUn)}`, c.stUn > 0 && `ST ${BRL(c.stUn)}`, c.freteUn > 0 && `frete ${BRL(c.freteUn)}`, c.difalUn > 0 && `DIFAL ${BRL(c.difalUn)}`].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td>
                      <b>{BRL(c.custoUn)}</b>
                    </td>
                    <td>{lg.produtoId && lg.produtoId !== "novo" && temMedia(lg.produtoId) ? `${BRL(custoAtual(lg.produtoId))} → recalcula` : "1ª compra"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-cards">
        <div className="panel">
          <h3>Pagamento (vai pro Caixa)</h3>
          {parcelas.length ? (
            <p>
              {parcelas.length}× — {parcelas.map((p) => `${dm(p.venc)} ${BRL(p.valor)}`).join(" · ")} <span className="muted-cel">(das duplicatas da nota)</span>
            </p>
          ) : (
            <>
              <p>
                Uma saída de {BRL(nota.totais.vNF)} em {dmy(nota.emissao)} <span className="muted-cel">(a nota não traz parcelas)</span>
              </p>
              <label className="check-inline">
                <input type="checkbox" checked={jaPaga} onChange={(e) => setJaPaga(e.target.checked)} /> já paga
              </label>
            </>
          )}
          <div className="check-inline" style={{ gap: 12 }}>
            Pago com:
            <label>
              <input type="radio" checked={pagoCom === "bolso"} onChange={() => setPagoCom("bolso")} /> meu bolso
            </label>
            <label>
              <input type="radio" checked={pagoCom === "loja"} onChange={() => setPagoCom("loja")} /> caixa da loja
            </label>
          </div>
          <p className="hint">Categoria "Mercadoria pra revenda".{calc.some((c) => c.difal > 0) ? " O DIFAL entra como uma saída à parte (Taxas / impostos), a pagar." : ""}</p>
        </div>
        <div className="panel">
          <h3>Ao gravar</h3>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>✓ +{fq(calc.filter((c) => ligacoes[c.n]?.produtoId).reduce((s, c) => s + c.quantidade, 0))} un no estoque</li>
            <li>✓ Custo médio atualizado (3 últimas notas) → lucro e preço sugerido ao vivo em todo o app</li>
            <li>✓ A mesma nota não entra 2× (chave da NF-e)</li>
          </ul>
          <label className="check-inline">
            <input type="checkbox" checked={contarMedia} onChange={(e) => setContarMedia(e.target.checked)} /> contar no custo médio (desmarque se foi compra de teste/pontual)
          </label>
        </div>
      </div>
      <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
        {faltam > 0 && <span className="muted-cel">Falta ligar {faltam}</span>}
        <button type="button" className="btn" onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button type="button" className="btn primary" onClick={gravar} disabled={salvando || faltam === calc.length}>
          {salvando ? "Gravando…" : faltam ? `Gravar sem ${faltam === 1 ? "este item" : "esses itens"}` : "Gravar nota"}
        </button>
      </div>
    </>
  );
}

// "BATOM MATTE NUDE 3,5G" → "Batom Matte Nude 3,5g"
function tituloBonito(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

// ---------------------------------------------------------------- Fornecedores
function Fornecedores({ est, onToast }) {
  const { lojaId } = useLoja();
  const [edit, setEdit] = useState(null);
  const [apagar, setApagar] = useState(null);
  const vazio = { nome: "", cnpj: "", uf: "", prazo_dias: "", pedido_minimo: "", contato: "", observacao: "" };
  return (
    <>
      <div className="panel">
        <h3>Fornecedores</h3>
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => setEdit({ ...vazio })}>
            + Fornecedor
          </button>
          <span className="hint" style={{ margin: 0 }}>
            Quem vem numa nota importada é cadastrado sozinho (pelo CNPJ). Aqui você completa o prazo de entrega — é ele que decide o aviso de repor.
          </span>
        </div>
        {est.fornecedores.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Prazo</th>
                  <th>Pedido mínimo</th>
                  <th>Notas</th>
                  <th>Última compra</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {est.fornecedores.map((f) => {
                  const notas = est.compras.filter((c) => c.fornecedor_id === f.id);
                  const ult = notas.map((c) => c.emissao).sort().pop();
                  return (
                    <tr key={f.id}>
                      <td>
                        <b>{f.nome}</b>
                        <div className="muted-cel">{[f.cnpj, f.uf, f.contato].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td>{f.prazo_dias != null ? `${f.prazo_dias} dias` : <span className="muted-cel">não informado</span>}</td>
                      <td>{f.pedido_minimo != null ? BRL(f.pedido_minimo) : "—"}</td>
                      <td>{notas.length}</td>
                      <td>{ult ? dmy(ult) : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="link-btn" onClick={() => setEdit({ ...vazio, ...f, prazo_dias: f.prazo_dias ?? "", pedido_minimo: f.pedido_minimo ?? "" })}>
                          ✎
                        </button>{" "}
                        {!notas.length && (
                          <button type="button" className="link-btn" onClick={() => setApagar(f)}>
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Nenhum fornecedor. Importe uma nota de compra ou cadastre aqui.</div>
        )}
      </div>
      {edit && (
        <EditarDialog
          titulo={edit.id ? `Editar ${edit.nome}` : "Novo fornecedor"}
          onCancelar={() => setEdit(null)}
          onSalvar={async () => {
            if (!edit.nome.trim()) return onToast?.("Digite o nome");
            const r = await salvarFornecedor({ lojaId, fornecedor: edit });
            onToast?.(r.error ? r.error.message : "Fornecedor salvo");
            if (!r.error) setEdit(null);
          }}
        >
          <div className="grid-auto">
            {[
              ["nome", "Nome"],
              ["cnpj", "CNPJ"],
              ["uf", "UF"],
              ["prazo_dias", "Prazo de entrega (dias)"],
              ["pedido_minimo", "Pedido mínimo (R$)"],
              ["contato", "Contato"],
            ].map(([k, rot]) => (
              <label key={k}>
                {rot}
                <input value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <label>
            Observação
            <input value={edit.observacao ?? ""} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} />
          </label>
        </EditarDialog>
      )}
      {apagar && (
        <ConfirmDialog
          titulo={`Excluir ${apagar.nome}?`}
          mensagem="Só fornecedor sem nota pode ser excluído."
          confirmarLabel="Excluir"
          perigo
          onCancel={() => setApagar(null)}
          onConfirm={async () => {
            const r = await excluirFornecedor(apagar.id);
            onToast?.(r.error ? r.error.message : "Fornecedor excluído");
            setApagar(null);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- Inventário
function Inventario({ est, onToast }) {
  const { lojaId } = useLoja();
  const linhas = est.linhas.filter((l) => !l.est.semControle);
  const [contado, setContado] = useState({});
  const [motivo, setMotivo] = useState({});
  const [salvando, setSalvando] = useState(false);
  const difs = diferencasInventario(linhas.map((l) => ({ produtoId: l.produto.id, nome: l.produto.nome, saldo: l.est.saldo, custo: l.custo, contado: contado[l.produto.id], motivo: motivo[l.produto.id] })));
  const contados = linhas.filter((l) => contado[l.produto.id] !== undefined && contado[l.produto.id] !== "").length;
  const saldoValor = difs.reduce((s, d) => s + d.diferenca * d.custo, 0);
  const ultimo = est.movimentos.filter((m) => m.tipo === "inventario").map((m) => m.data).sort().pop();
  const imprimir = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Contagem de estoque</title><style>body{font-family:sans-serif;font-size:13px}td,th{border:1px solid #ccc;padding:6px 10px}table{border-collapse:collapse}</style></head><body><h2>Contagem de estoque — ${dmy(est.hoje)}</h2><table><tr><th>Produto</th><th>SKU</th><th>Contei</th></tr>${linhas.map((l) => `<tr><td>${l.produto.nome}</td><td>${l.produto.sku || ""}</td><td style="width:90px"></td></tr>`).join("")}</table></body></html>`);
    w.document.close();
    w.print();
  };
  if (!linhas.length) return <div className="panel"><h3>Inventário</h3><div className="empty">Nenhum produto com estoque ainda — o estoque começa na 1ª nota importada.</div></div>;
  return (
    <>
      <div className="panel">
        <h3>Contagem de {dmy(est.hoje)}</h3>
        <p className="hint">
          Conte o que tem na prateleira e digite. Campo em branco = não contei (não muda nada). O app compara com o que deveria ter. Último inventário: {ultimo ? dmy(ultimo) : "nunca"} · sugestão: 1× por mês, ou quando aparecer estoque negativo.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>O app diz</th>
                <th>Contei</th>
                <th>Diferença</th>
                <th>Valor</th>
                <th>Motivo provável</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const d = difs.find((x) => x.produtoId === l.produto.id);
                const c = contado[l.produto.id];
                return (
                  <tr key={l.produto.id}>
                    <td>
                      <b>{l.produto.nome}</b>
                    </td>
                    <td>{fq(l.est.saldo)}</td>
                    <td>
                      <input style={{ width: 80 }} inputMode="decimal" placeholder="não contei" value={c ?? ""} onChange={(e) => setContado({ ...contado, [l.produto.id]: e.target.value })} />
                    </td>
                    <td style={{ fontWeight: 700, color: d ? (d.diferenca < 0 ? "var(--bad)" : undefined) : "var(--good)" }}>{c === undefined || c === "" ? "—" : d ? (d.diferenca > 0 ? `+${fq(d.diferenca)}` : fq(d.diferenca)) : "✓ bate"}</td>
                    <td>{d ? `${d.diferenca > 0 ? "+" : "−"} ${BRL(Math.abs(d.diferenca * l.custo))}` : "—"}</td>
                    <td>
                      {d && (
                        <select value={motivo[l.produto.id] || ""} onChange={(e) => setMotivo({ ...motivo, [l.produto.id]: e.target.value })}>
                          <option value="">Não sei</option>
                          {(d.diferenca < 0 ? ["Perda / quebra", "Brinde / amostra", "Uso próprio", "Venda fora dos marketplaces", "Erro de contagem anterior"] : ["Devolução que não voltou no app", "Nota não importada", "Erro de contagem anterior"]).map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>Resultado</h3>
        <p>
          {contados} de {linhas.length} itens contados · {contados - difs.length} {contados - difs.length === 1 ? "bate" : "batem"} · {difs.length} {difs.length === 1 ? "diferença" : "diferenças"}
          {difs.length > 0 && (
            <>
              {" "}
              · saldo das diferenças: <b>{`${saldoValor < 0 ? "−" : "+"} ${BRL(Math.abs(saldoValor))}`}</b>
            </>
          )}
        </p>
        <p className="hint">Ao gravar, o estoque passa a ser o contado (cada diferença vira um ajuste com o motivo, no histórico do item). Perda não mexe no custo médio.</p>
        <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={imprimir}>
            🖨 Imprimir lista de contagem
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={salvando || !contados}
            onClick={async () => {
              setSalvando(true);
              const r = await gravarInventario({ lojaId, diferencas: difs.map((d) => ({ produtoId: d.produtoId, diferenca: d.diferenca, motivo: d.motivo })), data: est.hoje });
              setSalvando(false);
              onToast?.(r.error ? r.error.message : difs.length ? `Inventário gravado: ${difs.length} ${difs.length === 1 ? "ajuste" : "ajustes"}` : "Tudo bate — nada a ajustar");
              if (!r.error) {
                setContado({});
                setMotivo({});
              }
            }}
          >
            {salvando ? "Gravando…" : "Gravar inventário"}
          </button>
        </div>
      </div>
    </>
  );
}
