import TelasSemUso from "./TelasSemUso.jsx";
import { useState } from "react";
import { MINIMO_AFILIADO, minimoAfiliado } from "../lib/comissaoLoja.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { regrasDaLoja } from "../lib/rampa.js";
import { regrasAds } from "../lib/ads.js";
import { ESCADA_PADRAO, configEscada } from "../lib/escada.js";
import { CAMPANHAS, DATAS_COMEMORATIVAS } from "../lib/calendario.js";
import { regimeDaLoja } from "../lib/revenda.js";
import { configSimples } from "../lib/simples.js";
import { ESTOQUE_PADRAO } from "../lib/pedidos.js";
import { configAtacado } from "../lib/vendaDireta.js";
import { irParaAba } from "../lib/navegar.js";
import MetasPrecoLoja from "./MetasPrecoLoja.jsx";
import CalendarioLoja from "./CalendarioLoja.jsx";
import { RegrasPortoes } from "./Crescimento.jsx";
import CuponsAtivos from "./CuponsAtivos.jsx";
import ImpostosLoja from "./ImpostosLoja.jsx";
import Ajuda from "./Ajuda.jsx";
import { ERPS, erpDaLoja } from "../lib/erp.js";

// Configuração → Regras (remap 21/10/2026): as regras da loja que ficavam
// espalhadas (metas de preço, calendário, escada, portões da rampa, Ads,
// estoque, atacado) num lugar só. Tudo continua gravando em
// lojas.config_escada, nas MESMAS chaves de antes — as telas leem igual.
const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;

// Cada seção começa RECOLHIDA mostrando o valor atual no título (28/10/2026, aprovado pela
// prévia) — dá pra bater o olho sem abrir. "Onde vale" fica dentro, ao abrir.
function Secao({ titulo, resumo, onde, ajuda, children, aberta = false }) {
  return (
    <details className="panel regras-sec" open={aberta}>
      <summary>
        <b>{titulo}</b>
        {ajuda && <Ajuda texto={ajuda} />}
        {resumo && <span className="regras-resumo">{resumo}</span>}
      </summary>
      <div className="regras-corpo">
        {onde && <p className="muted-cel" style={{ margin: "6px 0" }}>Vale em: {onde}</p>}
        {children}
      </div>
    </details>
  );
}
const pc = (v) => `${Math.round(Number(v || 0) * 100)}%`;
const reais = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
function resumos(cfg) {
  const reg = regimeDaLoja(cfg);
  const cs = configSimples(cfg);
  const m = configEscada(cfg, null);
  const cal = cfg.calendario || {};
  const datas = DATAS_COMEMORATIVAS.filter((d) => cal.datas?.[d.chave] !== false).length + (cal.proprias || []).length;
  const camp = CAMPANHAS.filter((c) => cal.campanhas?.[c.chave] !== false).length;
  const cup = Object.values(cfg.cupons || {}).filter((l) => (l || []).length);
  const rr = regrasDaLoja(cfg);
  const ra = regrasAds(cfg);
  const es = { ...ESTOQUE_PADRAO, ...(cfg.estoque || {}) };
  const at = configAtacado(cfg);
  return {
    erp: erpDaLoja(cfg).nome,
    impostos: reg.regime === "mei" ? `MEI${reg.dasMensal ? ` · DAS ${reais(reg.dasMensal)}/mês` : ""}` : reg.regime === "simples" ? `Simples · revenda Anexo ${cs.anexoRevenda} · fabricado Anexo ${cs.anexoFabricado}` : "escolha o regime",
    metas: `margem desejada ${pc(m.margemDesejada)} · mínima ${pc(m.margemMin)}${Number(m.lucroMinimo) > 0 ? ` · lucro mín. ${reais(m.lucroMinimo)}` : ""}`,
    calendario: `${datas} datas ligadas · ${camp === CAMPANHAS.length ? "todas as campanhas" : `${camp} de ${CAMPANHAS.length} campanhas`}`,
    cupons: cup.length ? `${cup.reduce((s, l) => s + l.length, 0)} faixa(s) em ${cup.length} canal(is)` : "nenhum cupom ativo",
    escada: `desconto máximo ${pc(cfg.descontoMax ?? ESCADA_PADRAO.descontoMax)}`,
    rampa: `passo ${pc(rr.passo)} · ${rr.semVendaDias} dias sem venda · lucro fica ≥ ${pc(rr.lucroFica)}`,
    ads: `aumento ${pc(ra.aumento)} · máx. ${pc(ra.aumentoMax)}`,
    estoque: `AX ${es.AX} · AY ${es.AY} · BX ${es.BX} dias + folga ${es.folgaFila}`,
    afiliados: `mínimo da Shopee ${pc(minimoAfiliado(cfg))} · afiliado leva no máx. metade do lucro`,
    atacado: at.faixas.map((f) => `${f.min}+ ${String(f.mult).replace(".", ",")}×`).join(" · "),
  };
}

export default function Regras({ onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const cfg = loja?.config_escada || {};
  const salvarChave = async (patch, msg) => {
    if (!loja) return;
    const r = await atualizar(loja.id, { configEscada: { ...(loja.config_escada || {}), ...patch } });
    onToast?.(r.ok ? msg : `Não foi possível salvar: ${r.error}`);
  };
  const rs = resumos(cfg);
  return (
    <div>
      <div className="alerta alerta-neutro">
        <b>Regras da loja {loja?.nome || ""}</b>
        Cada seção vale pro app inteiro desta loja. As telas continuam com o atalho pras regras delas — é a mesma configuração.
      </div>
      <Secao titulo="Sistema de pedidos (ERP)" resumo={rs.erp} onde="Atualizar dados (de onde vêm os pedidos), Início e Bom dia" ajuda="O sistema que junta os pedidos de todos os marketplaces desta loja. O Atualizar dados mostra o arquivo desse sistema. Cada loja escolhe o seu.">
        <div className="regras-erp">
          {ERPS.map((e) => (
            <label key={e.id} style={{ display: "block", margin: "4px 0" }}>
              <input type="radio" name="erp" checked={erpDaLoja(cfg).id === e.id} onChange={() => salvarChave({ erp: e.id }, `Sistema de pedidos: ${e.nome}`)} /> {e.nome}
              {!e.pronto && <span className="muted-cel"> — leitura do arquivo em preparação</span>}
            </label>
          ))}
        </div>
      </Secao>
      <Secao titulo="Impostos da loja (MEI ou Simples)" resumo={rs.impostos} aberta={!cfg.impostos?.regime} onde="preço e lucro de todo o app · limite do MEI no Início" ajuda="MEI: nenhum imposto por venda, DAS fixo por mês e limite de faturamento por ano (3D + revenda juntos). Simples: por enquanto o imposto (%) de cada canal.">
        <ImpostosLoja onToast={onToast} />
      </Secao>
      <Secao titulo="Metas de preço" resumo={rs.metas} onde="preço sugerido, mínimo aceitável e avisos de todo o app">
        <MetasPrecoLoja onToast={onToast} />
      </Secao>
      <Secao titulo="Calendário de vendas" resumo={rs.calendario} onde="rampa sazonal, Ads sazonal e lembretes de temporada">
        <CalendarioLoja onToast={onToast} />
      </Secao>
      <Secao titulo="Cupons ativos da loja" resumo={rs.cupons} onde="Rampa (O que digitar), Painel do anúncio e Promoções → Cupom da loja" ajuda="Os cupons que estão ligados na plataforma (ex.: Shopee 2% acima de R$ 5 · 5% acima de R$ 20). O app calcula o lucro de 1 unidade com o cupom da faixa que o preço alcança — o pior caso — e avisa se algum anúncio fica no prejuízo. Nenhum preço muda.">
        <CuponsAtivos onToast={onToast} />
      </Secao>
      <Secao titulo="Escada por quantidade (kits)" resumo={rs.escada} onde="usada em 2º Por quantidade, Produtos precificados e kits" ajuda="Curva de desconto dos kits: d(N) = desconto máximo × (1 − 1/N). As travas (mínimo aceitável, lucro sempre subindo, preço por peça caindo) continuam. Um produto pode ter a própria no 2º Por quantidade → Regras da escada.">
        <RegraEscada cfg={cfg} onSalvar={(v) => salvarChave({ descontoMax: v }, "Escada salva pra loja")} />
      </Secao>
      <Secao titulo="Rampa de preço (portões)" resumo={rs.rampa} onde="Vender mais → Rampa">
        {loja && <RegrasPortoes regras={regrasDaLoja(cfg)} loja={loja} atualizar={atualizar} onToast={onToast} />}
      </Secao>
      <Secao titulo="Ads" resumo={rs.ads} onde="Vender mais → Ads (o teto por faixas fica no KPI Teto de Ads → ver tabela)">
        <RegraAds cfg={cfg} onSalvar={(aumento) => salvarChave({ ads: { ...(cfg.ads || {}), aumento } }, "Regras do Ads salvas pra loja")} />
      </Secao>
      <Secao titulo="Afiliados" resumo={rs.afiliados} onde="Vender mais → Afiliados" ajuda="Comissão mínima que a plataforma aceita (a Shopee: 4% na maioria das categorias — confira no painel quando for configurar). Produto que não aguenta esse mínimo com metade do lucro aparece como “não compensa”.">
        <RegraAfiliados cfg={cfg} onSalvar={(afiliados) => salvarChave({ afiliados }, "Regra de afiliados salva")} />
      </Secao>
      <Secao titulo="Telas que você não abriu" resumo="revisar o que não se usa" onde="só a lista e o seu voto — nada some sozinho">
        <TelasSemUso />
      </Secao>
      <Secao titulo="Estoque sugerido" resumo={rs.estoque} onde="Análise → Curva XYZ" ajuda="Dias de cobertura por classe (AX, AY, BX) + folga da fila de impressão; o resto fica sob pedido. Só sugestão — o app não controla estoque.">
        <RegraEstoque cfg={cfg} onSalvar={(estoque) => salvarChave({ estoque }, "Regras do estoque salvas")} />
      </Secao>
      <Secao titulo="Atacado e personalização" resumo={rs.atacado} onde="Vender mais → Orçamento e atacado">
        <ResumoAtacado cfg={cfg} />
      </Secao>
    </div>
  );
}

function RegraEscada({ cfg, onSalvar }) {
  const [v, setV] = useState(String(Math.round((cfg.descontoMax ?? ESCADA_PADRAO.descontoMax) * 100)));
  return (
    <div className="grid-auto">
      <div className="field">
        <label>Desconto máximo da curva (%)</label>
        <input type="number" min="0" max="60" value={v} onChange={(e) => setV(e.target.value)} />
      </div>
      <div className="field">
        <label>&nbsp;</label>
        <button type="button" className="btn primary" onClick={() => onSalvar(num(v) / 100)}>Salvar</button>
      </div>
      <p className="muted-cel">Padrão {Math.round(ESCADA_PADRAO.descontoMax * 100)}% → kit 2 com até {Math.round(ESCADA_PADRAO.descontoMax * 50)}% de desconto, kit 3 até {Math.round(ESCADA_PADRAO.descontoMax * 66.7)}%.</p>
    </div>
  );
}

function RegraAds({ cfg, onSalvar }) {
  const ra = regrasAds(cfg);
  const [v, setV] = useState(String(Math.round(ra.aumento * 100)));
  return (
    <div className="grid-auto">
      <div className="field">
        <label>Aumento por semana com retorno 1,2–2× (%)</label>
        <input type="number" min="1" max="100" value={v} onChange={(e) => setV(e.target.value)} />
      </div>
      <div className="field">
        <label>&nbsp;</label>
        <button type="button" className="btn primary" onClick={() => onSalvar(num(v) / 100)}>Salvar</button>
      </div>
      <p className="muted-cel">Retorno ≥ 2× sobe até {Math.round(ra.aumentoMax * 100)}%. Abaixo do equilíbrio volta 1 degrau no orçamento. Decisão 1× por semana.</p>
    </div>
  );
}

function RegraAfiliados({ cfg, onSalvar }) {
  const [v, setV] = useState(String(Math.round(minimoAfiliado(cfg) * 1000) / 10).replace(".", ","));
  return (
    <div className="grid-auto">
      <div className="field">
        <label>Comissão mínima da plataforma (%)</label>
        <input type="number" min="0" step="0.5" value={v.replace(",", ".")} onChange={(e) => setV(e.target.value)} />
      </div>
      <div className="field">
        <label>&nbsp;</label>
        <button type="button" className="btn primary" onClick={() => onSalvar({ ...(cfg.afiliados || {}), minimo: num(v) / 100 || MINIMO_AFILIADO })}>
          Salvar
        </button>
      </div>
    </div>
  );
}

function RegraEstoque({ cfg, onSalvar }) {
  const r0 = { ...ESTOQUE_PADRAO, ...(cfg.estoque || {}) };
  const [f, setF] = useState(Object.fromEntries(Object.entries(r0).map(([k, v]) => [k, String(v)])));
  const campos = [
    ["AX", "AX: dias de cobertura"],
    ["AY", "AY: dias de cobertura"],
    ["BX", "BX: dias de cobertura"],
    ["folgaFila", "Folga da fila de impressão (dias)"],
  ];
  return (
    <div className="grid-auto">
      {campos.map(([k, rot]) => (
        <div className="field" key={k}>
          <label>{rot}</label>
          <input type="number" min="0" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </div>
      ))}
      <div className="field">
        <label>&nbsp;</label>
        <button type="button" className="btn primary" onClick={() => onSalvar(Object.fromEntries(campos.map(([k]) => [k, num(f[k])])))}>Salvar</button>
      </div>
    </div>
  );
}

function ResumoAtacado({ cfg }) {
  const a = configAtacado(cfg);
  return (
    <div>
      <p>
        Faixas: {a.faixas.map((f) => `${f.min}+ peças = ${String(f.mult).replace(".", ",")}× o custo`).join(" · ")}. Arte por pedido R$ {a.arte.toFixed(2).replace(".", ",")}, personalização R$ {a.porPeca.toFixed(2).replace(".", ",")} por peça
        {a.isentarArte ? `, arte isenta a partir de ${a.isentarArteMin} peças` : ""}.
      </p>
      <button type="button" className="btn btn-mini" onClick={() => irParaAba("orcamento")}>Editar em Orçamento e atacado →</button>
    </div>
  );
}
