// Guia de uso do app — só leitura, sem dados nem cálculos. Segue a mesma
// ordem das etapas do menu lateral (GRUPOS em App.jsx) pra funcionar como
// um passo a passo de verdade: configura loja → cadastra dados-base →
// precifica → vende → gerencia.

const ETAPAS = [
  {
    titulo: "1. Configuração",
    intro: "Antes de qualquer coisa, defina em qual loja você está trabalhando.",
    passos: [
      {
        icone: "🏬",
        nome: "Lojas",
        texto:
          'Cadastre cada loja/negócio que você usa no app (ex: "Ohra - 3D"). Cada loja pode ter um PIN de 4 números — se tiver, o app pede o PIN toda vez que você entra ou troca pra ela, e nada daquela loja aparece antes disso. Materiais, produtos, preços e histórico são todos separados por loja: troque a loja atual no seletor no topo do menu lateral.',
      },
    ],
  },
  {
    titulo: "2. Cadastros",
    intro:
      "É aqui que fica tudo que se repete de produto pra produto — cadastre uma vez e reaproveite no cálculo de custo. Tudo dentro da aba \"Cadastros\", em sub-abas.",
    passos: [
      {
        icone: "🧵",
        nome: "Materiais (Fabricação)",
        texto:
          'O que entra na fabricação da peça. Tipo "Filamento" é precificado por kg (PLA, PETG etc.). Tipo "Consumível" é precificado por unidade — cola, lixa, spray, tinta, o que for gasto aos poucos e não entra na receita de peso da peça.',
      },
      {
        icone: "📦",
        nome: "Embalagens",
        texto:
          "O que vai junto no envio, fora da peça em si: caixa, plástico bolha, envelope plástico, envelope de segurança, mimo etc. Cadastre nome, preço e unidade — depois é só montar a receita de embalagem de cada produto ou kit puxando daqui.",
      },
      {
        icone: "🧱",
        nome: "Produtos",
        texto:
          "O cadastro central de cada produto que você vende. Além do nome e custo, dá pra montar a receita de itens de embalagem (quanto de cada item cadastrado acima esse produto gasta pra ser enviado) — o total substitui o campo manual de embalagem e atualiza sozinho se o preço de um item mudar. Esse cadastro é usado no Comparativo, Orçamento, Promoções e Otimização.",
      },
      {
        icone: "🎁",
        nome: "Kits",
        texto:
          'Combos de produtos já cadastrados. O custo de fabricação do kit é a soma do custo de cada produto incluso, mas a embalagem do kit é independente — nunca é a soma automática das embalagens de cada produto (às vezes cabe tudo numa caixa só). Use o botão "Sugerir com base nos produtos escolhidos" como ponto de partida e ajuste à mão.',
      },
      {
        icone: "🏷️",
        nome: "Canais",
        texto:
          "As regras de cada canal de venda (Shopee, Mercado Livre). Comissão e taxa fixa seguem as faixas oficiais, calculadas automaticamente pelo app. Imposto e custos fixos são o que você configura por canal. O % de Ads é quanto você costuma investir em anúncio patrocinado — só usado pra mostrar o lucro com Ads no Comparativo, não muda o preço de venda.",
      },
    ],
  },
  {
    titulo: "3. Precificar",
    intro: "Com os cadastros prontos, calcule o custo de uma peça e o preço ideal pra vender.",
    passos: [
      {
        icone: "🧮",
        nome: "Custo de Produção",
        texto:
          "Ponto de partida de tudo: digite os dados que o fatiador (slicer) mostra antes de imprimir — comprimento de filamento, tempo de impressão etc. O app calcula o peso da peça e soma material, energia, manutenção, falhas, consumíveis e o rateio (ROI) da impressora até chegar no custo de produção total. Dali dá pra levar o custo direto pra Precificação por Canal, ou salvar a peça como Produto.",
      },
      {
        icone: "🏷️",
        nome: "Precificação por Canal",
        texto:
          "Pega um custo (vindo da Custo de Produção ou digitado na mão) e calcula o preço de venda pra um canal específico, dada a margem líquida que você quer garantir — o app já desconta comissão, taxa fixa, imposto e custos extras daquele canal antes de sugerir o preço.",
      },
      {
        icone: "📊",
        nome: "Comparativo",
        texto:
          "Mostra todos os canais ativos lado a lado pro mesmo produto, com o termômetro de margem (verde/vermelho conforme a meta) e o lucro com e sem Ads — bom pra decidir onde vale mais a pena vender aquela peça.",
      },
    ],
  },
  {
    titulo: "4. Vender",
    intro: "Ferramentas pro dia a dia de atender pedido e rodar promoção.",
    passos: [
      {
        icone: "🧾",
        nome: "Orçamento",
        texto:
          'Duas sub-abas: "Encomenda avulsa" é pra venda direta, fora de marketplace, sem comissão nem taxa fixa de plataforma — puxe um produto cadastrado ou preencha na mão pra algo sob medida. "Encomenda em volume" calcula o preço por lote, diluindo o frete entre as peças (quanto mais peças no lote, menor o frete por unidade).',
      },
      {
        icone: "🎁",
        nome: "Promoções",
        texto:
          "Simula o impacto de um desconto no lucro, a partir do preço normal do canal escolhido. Dá pra simular desconto por faixa de quantidade (a taxa fixa do canal continua sendo cobrada por unidade) ou um kit fechado vendido como pedido único (taxa fixa cobrada uma vez só, o que ajuda a bancar o desconto).",
      },
    ],
  },
  {
    titulo: "5. Gestão",
    intro: "Pra olhar o negócio de um passo atrás: capacidade de produção e o que já foi calculado antes.",
    passos: [
      {
        icone: "📈",
        nome: "Otimização",
        texto:
          "Analisa sua capacidade real de produção: quantas impressoras você tem e quantas horas elas rodam por dia (isso roda sozinho), e quanto do seu próprio tempo (mão de obra) cada peça consome pra trocar impressão, acabar e embalar. Com isso o app mostra se o gargalo é impressora ou é você, e quanto dá pra produzir por dia.",
      },
      {
        icone: "🕘",
        nome: "Histórico",
        texto: "Lista de todos os produtos já salvos, com data. Dá pra reabrir, renomear ou excluir um cálculo salvo.",
      },
    ],
  },
];

const GLOSSARIO = [
  {
    termo: "Markup",
    def: 'Multiplicador aplicado sobre o custo total pra chegar num preço — 100% de markup significa vender pelo dobro do custo. É uma conta rápida, sem considerar taxa de canal; pra preço final de Shopee/ML, use a Precificação por Canal.',
  },
  {
    termo: "Margem líquida (lucratividade)",
    def: "O quanto sobra de lucro sobre o preço de venda, já descontado tudo (custo, comissão, taxa fixa, imposto, Ads etc.). É a meta que você define, e é ela que decide o preço sugerido.",
  },
  {
    termo: "Comissão e taxa fixa",
    def: "O que Shopee/Mercado Livre descontam de cada venda, seguindo as faixas oficiais de cada plataforma — calculadas automaticamente a partir do preço e categoria.",
  },
  {
    termo: "% de Ads",
    def: "Quanto você costuma investir em anúncio patrocinado dentro do canal, como % do preço. O app usa isso só pra mostrar o lucro \"com Ads\" no Comparativo — o preço de venda não muda.",
  },
  {
    termo: "ROI da máquina",
    def: "Rateio do valor pago na impressora entre as peças produzidas até você reaver o investimento no prazo que definir — quanto mais peças/horas de uso, menor esse custo por peça.",
  },
];

export default function Tutorial() {
  return (
    <div>
      <div className="panel">
        <h3>Como usar o Ohra</h3>
        <p style={{ margin: "0 0 4px", fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6 }}>
          O app segue o mesmo fluxo do menu lateral, de cima pra baixo: primeiro você configura a loja, depois
          cadastra os dados que se repetem (materiais, embalagens, produtos, canais), depois calcula o custo e o
          preço de uma peça, depois usa isso pra vender e, por fim, acompanha capacidade e histórico. Abaixo vai um
          passo a passo rápido de cada etapa.
        </p>
      </div>

      {ETAPAS.map((etapa) => (
        <div className="panel" key={etapa.titulo}>
          <h3 className="section-title">{etapa.titulo}</h3>
          <p className="hint" style={{ marginTop: -4 }}>
            {etapa.intro}
          </p>
          {etapa.passos.map((p) => (
            <div className="tutorial-passo" key={p.nome}>
              <span className="tutorial-icone">{p.icone}</span>
              <div className="tutorial-passo-corpo">
                <h4>{p.nome}</h4>
                <p>{p.texto}</p>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="panel">
        <h3>Glossário rápido</h3>
        <dl className="tutorial-glossario">
          {GLOSSARIO.map((g) => (
            <div key={g.termo}>
              <dt>{g.termo}</dt>
              <dd>{g.def}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
