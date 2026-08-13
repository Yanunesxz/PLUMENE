import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PedidoPublico } from '@csb/shared';

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

/** Os três passos e como ficam conforme o andamento do pedido. */
function passos(p: PedidoPublico['passo']): Array<{ lbl: string; cls: string }> {
  const ordem = ['enviado', 'aprovado', 'entregue'] as const;
  const atual = p === 'recusado' ? 0 : ordem.indexOf(p);
  const rot = ['Enviado para a fábrica', 'Aprovado', 'Entregue'];
  return rot.map((lbl, i) => ({
    lbl,
    cls: i < atual ? 'feito' : i === atual ? 'atual' : '',
  }));
}

const CamIcon = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.7" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

export function PaginaPedidoPublico() {
  const { token } = useParams();
  const [estado, setEstado] = useState<'carregando' | 'erro' | PedidoPublico>('carregando');

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/public/pedido/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('nao encontrado'))))
      .then((j) => {
        if (vivo) setEstado((j as { data: PedidoPublico }).data);
      })
      .catch(() => {
        if (vivo) setEstado('erro');
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  return (
    <>
      <style>{CSS}</style>
      {estado === 'carregando' && <div className="centro">Carregando o pedido…</div>}
      {estado === 'erro' && (
        <div className="centro">
          <div>
            <p className="cs-brand" style={{ fontSize: 24 }}>Corpo Sensual</p>
            <p style={{ marginTop: 12 }}>Este link não está mais disponível. Fale com o seu representante.</p>
          </div>
        </div>
      )}
      {typeof estado === 'object' && estado.expirado && (
        <div className="centro">
          <div>
            <p className="cs-brand" style={{ fontSize: 24 }}>Corpo Sensual</p>
            <p style={{ marginTop: 12 }}>Este link expirou (fica disponível por 7 dias após o faturamento).</p>
          </div>
        </div>
      )}
      {typeof estado === 'object' && !estado.expirado && <Conteudo p={estado} />}
    </>
  );
}

function Conteudo({ p }: { p: PedidoPublico }) {
  const badge =
    p.passo === 'recusado' ? 'Recusado' : p.passo === 'aprovado' ? 'Aprovado' : 'Enviado para a fábrica';
  return (
    <div className="wrap">
      <header>
        <p className="cs-brand">Corpo Sensual<span>Representantes</span></p>
      </header>

      <div className="resumo">
        <div className="top">
          <h1>Pedido #{p.numero}</h1>
          <span className={`badge ${p.passo === 'recusado' ? 'ruim' : ''}`}>{badge}</span>
        </div>
        <p className="sub">
          Feito em {dataBR(p.data)} · {p.cliente}
          {p.condicaoDePagamento ? <> · Pagamento: {p.condicaoDePagamento}</> : null}
        </p>
        <div className="passos">
          {passos(p.passo).map((s) => (
            <div key={s.lbl} className={`passo ${s.cls}`}>
              <div className="dot" />
              <div className="lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="titulo-secao">
        As peças que você escolheu <span>· {p.produtos.length} referências</span>
      </h2>

      <div className="grade">
        {p.produtos.map((prod) => (
          <div className="produto" key={prod.ref + prod.nome}>
            <div className="foto">
              <span className="ref-tag">{prod.ref}</span>
              {prod.foto ? <img src={prod.foto} alt={prod.nome} loading="lazy" /> : <CamIcon />}
            </div>
            <div className="info">
              <div className="nome">{prod.nome}</div>
              <div className="grelha">
                {prod.tamanhos.map((t) => (
                  <span className="chip" key={t.tamanho}>{t.tamanho} · {t.quantidade}</span>
                ))}
              </div>
              <div className="linha-preco">
                <span className="q">{prod.pecas} peças · <span className="unit">{brl(prod.unit_price)}/un</span></span>
                <span className="v">{brl(prod.total)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="total-bar">
        <div className="esq">
          <div className="r">Total do pedido</div>
          <div className="v">{brl(p.total)}</div>
        </div>
        <div className="pecas">{p.totalPecas} peças em {p.produtos.length} referências</div>
        <button className="btn-pdf" onClick={() => window.print()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Baixar PDF
        </button>
      </div>

      <footer>
        <p>Pedido feito com <span className="rep">{p.representante}</span>, seu representante Corpo Sensual.</p>
        <p className="aviso">Este link fica disponível por 7 dias após o faturamento do pedido.</p>
      </footer>
    </div>
  );
}

const CSS = `
  .pp-scope,:root{}
  body { margin: 0; }
  .wrap, .centro { --page:#efe9e6; --card:#fff; --ink:#2a2224; --soft:#7c6f71; --line:#e7ded9; --wine:#6d2740; --wine-sf:#f4e9ec; --gold:#a98b5a; --ok:#2f6d4f; --ok-sf:#e7f0ea; --ph1:#f2eae5; --ph2:#e6d8d0; --danger:#973232; --danger-sf:#f4e2e2;
    --serif:"Bodoni Moda",Georgia,serif; --sans:"Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif; }
  @media (prefers-color-scheme: dark) { .wrap, .centro { --page:#17110f; --card:#211a18; --ink:#efe6e2; --soft:#a99a94; --line:#332826; --wine:#d98aa2; --wine-sf:#2c1a20; --gold:#c8a86e; --ok:#7cc79c; --ok-sf:#16271e; --ph1:#2a211e; --ph2:#372b27; --danger:#e08a8a; --danger-sf:#2b1717; } }
  .centro { min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center; background:var(--page); color:var(--soft); font-family:var(--sans); padding:24px; }
  .cs-brand { font-family:var(--serif); font-weight:500; letter-spacing:.05em; margin:0; color:var(--ink); }
  .cs-brand span { display:block; font-family:var(--sans); font-size:9.5px; letter-spacing:.4em; text-transform:uppercase; color:var(--gold); margin-top:7px; font-weight:600; }
  .wrap { background:var(--page); color:var(--ink); font-family:var(--sans); min-height:100vh; max-width:940px; margin:0 auto; padding:0 18px 120px; -webkit-font-smoothing:antialiased; box-sizing:border-box; }
  .wrap * { box-sizing:border-box; }
  .wrap header { text-align:center; padding:30px 0 22px; }
  .wrap header .cs-brand { font-size:27px; }
  .resumo { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:24px 26px; }
  .resumo .top { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:10px; }
  .resumo h1 { font-family:var(--serif); font-size:26px; margin:0; font-weight:500; }
  .badge { font-size:12px; font-weight:700; padding:5px 13px; border-radius:999px; background:var(--ok-sf); color:var(--ok); white-space:nowrap; }
  .badge.ruim { background:var(--danger-sf); color:var(--danger); }
  .sub { color:var(--soft); font-size:14px; margin:6px 0 0; }
  .passos { display:flex; margin-top:22px; }
  .passo { flex:1; text-align:center; position:relative; }
  .passo .dot { width:12px; height:12px; border-radius:50%; background:var(--line); margin:0 auto 8px; position:relative; z-index:1; }
  .passo::before { content:""; position:absolute; top:5px; left:-50%; width:100%; height:2px; background:var(--line); }
  .passo:first-child::before { display:none; }
  .passo .lbl { font-size:11px; color:var(--soft); }
  .passo.feito .dot, .passo.feito::before { background:var(--ok); }
  .passo.atual .dot { background:var(--wine); box-shadow:0 0 0 4px var(--wine-sf); }
  .passo.atual .lbl { color:var(--wine); font-weight:700; }
  .titulo-secao { font-family:var(--serif); font-size:18px; margin:34px 4px 14px; font-weight:500; color:var(--ink); }
  .titulo-secao span { color:var(--soft); font-family:var(--sans); font-size:13px; }
  .grade { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  @media (max-width:720px){ .grade{ grid-template-columns:repeat(2,1fr); gap:12px; } }
  @media (max-width:440px){ .grade{ grid-template-columns:1fr; } }
  .produto { background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
  .foto { aspect-ratio:3/4; background:linear-gradient(150deg,var(--ph1),var(--ph2)); display:flex; align-items:center; justify-content:center; color:var(--soft); position:relative; }
  .foto img { width:100%; height:100%; object-fit:cover; }
  .foto .ref-tag { position:absolute; top:10px; left:10px; background:var(--card); color:var(--ink); font-size:12px; font-weight:700; padding:3px 9px; border-radius:5px; z-index:1; box-shadow:0 1px 4px rgba(0,0,0,.08); }
  .info { padding:13px 14px 15px; display:flex; flex-direction:column; gap:9px; flex:1; }
  .nome { font-size:13.5px; line-height:1.35; color:var(--ink); font-weight:600; }
  .grelha { display:flex; flex-wrap:wrap; gap:5px; }
  .chip { font-size:11.5px; font-weight:600; background:var(--wine-sf); color:var(--wine); padding:3px 8px; border-radius:5px; font-variant-numeric:tabular-nums; }
  .linha-preco { margin-top:auto; display:flex; align-items:baseline; justify-content:space-between; padding-top:8px; border-top:1px solid var(--line); }
  .linha-preco .q { font-size:12px; color:var(--soft); }
  .linha-preco .v { font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; }
  .unit { font-size:11px; color:var(--soft); }
  .total-bar { position:sticky; bottom:0; margin-top:26px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px 22px; display:flex; align-items:center; justify-content:space-between; gap:14px; box-shadow:0 -2px 20px rgba(0,0,0,.05); flex-wrap:wrap; }
  .total-bar .esq .r { font-size:12px; color:var(--soft); letter-spacing:.04em; text-transform:uppercase; }
  .total-bar .esq .v { font-family:var(--serif); font-size:26px; font-weight:500; }
  .total-bar .pecas { font-size:13px; color:var(--soft); }
  .btn-pdf { cursor:pointer; border:none; background:var(--ink); color:var(--page); font-size:13.5px; font-weight:600; padding:12px 20px; border-radius:6px; display:inline-flex; align-items:center; gap:8px; font-family:var(--sans); }
  .wrap footer { text-align:center; margin-top:30px; color:var(--soft); font-size:12.5px; line-height:1.6; }
  .wrap footer .rep { color:var(--ink); font-weight:600; }
  .aviso { font-size:11.5px; color:var(--soft); margin:8px 0 0; }
  @media print { .total-bar{ position:static; box-shadow:none; } .btn-pdf{ display:none; } .wrap{ padding-bottom:20px; } }
`;
