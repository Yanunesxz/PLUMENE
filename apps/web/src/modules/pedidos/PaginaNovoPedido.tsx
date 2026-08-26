import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2, Minus, Plus, WifiOff, ShoppingCart, AlertCircle } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useCartStore } from '../../store/cartStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { api } from '../../services/api.js';
import { addToSyncQueue } from '../../offline/sync.js';
import { Button } from '../../components/interface/Button.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { SeletorTamanho } from '../../components/comercial/SeletorTamanho.js';
import { CampoDesconto } from '../../components/comercial/CampoDesconto.js';
import { ConfirmarTabela } from '../../components/comercial/ConfirmarTabela.js';
import { useMinhasTabelas } from '../../hooks/useMinhasTabelas.js';
import { useCondicoesDePagamento } from '../../hooks/useCondicoesDePagamento.js';
import { Textarea } from '../../components/interface/Textarea.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import { observacaoDeCores, juntarObservacao } from '@csb/shared';
import { compararReferencia } from '../../lib/pedido.js';
import { compararTamanho } from '../../components/comercial/grade.js';
import type { CreateOrderRequest, ApiResponse, OrderWithItems, ProductWithPrice } from '@csb/shared';
import { precoDoTamanho } from '@csb/shared';

export function PaginaNovoPedido() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();

  const preselectedCustomerId = params.get('customer_id') ?? '';

  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setUnitPrice = useCartStore((s) => s.setUnitPrice);
  const removeItem = useCartStore((s) => s.remove);
  const addToCart = useCartStore((s) => s.add);
  const clearCart = useCartStore((s) => s.clear);

  // A loja compra para ela mesma: não escolhe cliente, não tem carteira para
  // escolher (a rota `/customers` é negada para ela) e o servidor carimba o
  // cliente pelo token. Sem este caminho, a tela travava em "selecione o
  // cliente" com uma lista que nunca ia carregar.
  const ehLoja = user?.role === 'store';
  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [notes, setNotes] = useState('');
  // Condição de pagamento do Control ("30/60/90 DIAS"). Opcional: sem escolha,
  // o COND PGTO da planilha sai em branco e a fábrica preenche, como sempre.
  const [condicaoId, setCondicaoId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<{ product: ProductWithPrice; group: ProductWithPrice[] } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const customers = useLiveQuery(() => db.customers.filter((c) => !c.blocked).toArray(), []);
  const condicoes = useCondicoesDePagamento();
  // Booleano não é chave indexável no IndexedDB — lemos tudo e filtramos em memória.
  const allProducts = useLiveQuery(() => db.products.toArray(), []);
  const activeProducts = useMemo(() => (allProducts ?? []).filter((p) => p.active), [allProducts]);

  const selectedCustomer = customers?.find((c) => c.id === customerId);

  useEffect(() => {
    if (preselectedCustomerId) setCustomerId(preselectedCustomerId);
  }, [preselectedCustomerId]);

  // ─── A tabela vem do cadastro do cliente ───────────────────────────────────
  // Ninguém escolhe aqui: quem manda no preço é o cadastro. O que a tela faz é
  // não deixar o representante ver um preço e o servidor cobrar outro.
  const { nomeDe } = useMinhasTabelas();

  /** A tabela que precifica ESTE pedido: a do cliente, caindo para a do rep. */
  const tabelaDoPedido = ehLoja
    ? null
    : (selectedCustomer?.price_table_id ?? user?.price_table_id ?? null);

  /** Em qual tabela os preços que estão na tela foram buscados. */
  const [tabelaAplicada, setTabelaAplicada] = useState<string | null>(null);
  const [reprecificando, setReprecificando] = useState(false);

  /**
   * Trocar de cliente reprecifica o carrinho na tabela DELE.
   *
   * O catálogo é baixado na tabela do próprio representante. Sem isto, quem
   * atende clientes de tabelas diferentes montava o pedido vendo o preço de uma
   * e recebia o total de outra — o servidor sempre precificou pelo cadastro do
   * cliente. Produto sem preço na tabela dele sai do carrinho: mantê-lo faria o
   * pedido inteiro ser recusado com "preço não encontrado", sem dizer qual item.
   *
   * Tabela fora do conjunto do representante devolve 403 de propósito (ele não
   * pode ver o preço da região vizinha). Aí os preços ficam como estão e a
   * confirmação, no fim, avisa que não dá para conferir.
   */
  useEffect(() => {
    if (!token || !tabelaDoPedido || tabelaDoPedido === tabelaAplicada) return;
    let vivo = true;
    setReprecificando(true);
    void api
      .getLista<ApiResponse<ProductWithPrice[]>>(
        `/products?price_table_id=${encodeURIComponent(tabelaDoPedido)}`,
        token,
      )
      .then(async (res) => {
        if (!vivo) return;
        await db.products.bulkPut(res.data);
        // Guarda as DUAS faixas: reprecificar pelo `price` puro rebaixaria todo
        // EG e toda peça da grade plus ao preço do tamanho normal — desfazendo,
        // em silêncio, o preço que o servidor vai cobrar no envio.
        const precoPor = new Map(res.data.map((p) => [p.id, p]));
        const semPreco: string[] = [];
        let mudou = 0;
        for (const item of useCartStore.getState().items) {
          const doCatalogo = precoPor.get(item.product_id);
          const preco = doCatalogo
            ? precoDoTamanho(item.size, doCatalogo.price, doCatalogo.price_larger)
            : null;
          if (preco == null) {
            semPreco.push(item.sku);
            removeItem(item.product_id, item.size, item.color_code);
            continue;
          }
          if (preco !== item.unit_price) {
            setUnitPrice(item.product_id, item.size, preco, item.color_code);
            mudou++;
          }
        }
        setTabelaAplicada(tabelaDoPedido);
        if (semPreco.length > 0) {
          setToast({
            message: `Sem preço na tabela deste cliente e removido(s): ${semPreco.join(', ')}.`,
            type: 'error',
          });
        } else if (mudou > 0) {
          setToast({ message: 'Preços ajustados para a tabela deste cliente.', type: 'info' });
        }
      })
      .catch(() => {
        // 403 (tabela de outra região) ou offline: não mexe nos preços.
        if (vivo) setTabelaAplicada(null);
      })
      .finally(() => {
        if (vivo) setReprecificando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token, tabelaDoPedido, tabelaAplicada, removeItem, setUnitPrice]);

  /**
   * Conserta o carrinho que ficou parado no aparelho com preço velho.
   *
   * O carrinho guarda o `unit_price` de quando a peça foi adicionada e é
   * persistido — um pedido montado semana passada abre hoje com os preços
   * daquele dia. Quando a tabela da fábrica muda no meio (foi o que aconteceu
   * com o preço do EG e da grade plus), o representante vê um total e o servidor
   * cobra outro, porque ele recalcula tudo no envio.
   *
   * Confere contra o catálogo que está em cache — que é o mesmo de onde as peças
   * foram adicionadas — e ajusta só a linha que divergiu. A reprecificação por
   * tabela, acima, continua mandando quando o cliente tem tabela própria.
   */
  useEffect(() => {
    if (!allProducts || allProducts.length === 0) return;
    const porId = new Map(allProducts.map((p) => [p.id, p]));
    let corrigidas = 0;
    for (const item of useCartStore.getState().items) {
      const doCatalogo = porId.get(item.product_id);
      if (!doCatalogo) continue;
      const preco = precoDoTamanho(item.size, doCatalogo.price, doCatalogo.price_larger);
      if (preco == null || preco === item.unit_price) continue;
      setUnitPrice(item.product_id, item.size, preco, item.color_code);
      corrigidas++;
    }
    if (corrigidas > 0) {
      setToast({
        message:
          corrigidas === 1
            ? 'Um item do pedido estava com preço desatualizado e foi corrigido.'
            : `${corrigidas} itens do pedido estavam com preço desatualizado e foram corrigidos.`,
        type: 'info',
      });
    }
  }, [allProducts, setUnitPrice]);

  /**
   * O que a confirmação vai dizer antes de enviar. `null` = não há o que
   * confirmar (loja, ou tabela de outra região que ele não pode ver).
   */
  const confirmacaoDaTabela = (() => {
    if (ehLoja || !customerId) return null;
    const doCliente = selectedCustomer?.price_table_id ?? null;

    if (!doCliente) {
      const minha = nomeDe(user?.price_table_id);
      return {
        titulo: 'Este cliente não tem tabela cadastrada.',
        detalhe: minha
          ? `O pedido vai sair na sua tabela, ${minha}. Se não for essa, corrija o cadastro do cliente antes de enviar.`
          : 'O pedido vai sair na sua tabela. Se não for essa, corrija o cadastro do cliente antes de enviar.',
        tabela: minha ?? '',
        rotuloConfirmar: 'Enviar assim mesmo',
      };
    }

    const nome = nomeDe(doCliente);
    if (!nome) return null; // Tabela fora do conjunto dele: não há nome a mostrar.

    return {
      titulo: `Este cliente está cadastrado na ${nome}. Está correta?`,
      detalhe: 'É esta tabela que define o preço do pedido. Se estiver errada, corrija o cadastro do cliente antes de enviar.',
      tabela: nome,
      rotuloConfirmar: undefined,
    };
  })();

  const [confirmando, setConfirmando] = useState(false);

  // Abre o seletor de tamanho para o produto escolhido na busca.
  const addItem = (product_id: string) => {
    const product = activeProducts.find((p) => p.id === product_id);
    if (!product) return;
    // Abre com todas as cores do mesmo modelo (para escolher a cor no seletor).
    const group = product.variant_group
      ? activeProducts.filter((p) => p.variant_group === product.variant_group)
      : [product];
    setPicker({ product, group });
  };

  // Rep não edita preço (segue a tabela do representante); só gerente/admin ajusta.
  const canEditPrice = user?.role === 'manager' || user?.role === 'admin';

  /**
   * O desconto do pedido inteiro, fechado AQUI na montagem — o pedido do rep
   * nasce direto na fila do gerente, então não existe "depois" para dar a %.
   * Só o representante vê os botões; o servidor descarta o campo de qualquer
   * outro papel.
   */
  const ehRep = user?.role === 'rep';
  // Guardamos o PERCENTUAL mesmo quando ele digita em reais: é o que vai para o
  // servidor e para a planilha. A conversão usa a soma das peças da tela, que
  // aqui é a mesma que o servidor vai calcular (os preços já vieram da tabela).
  const [descontoPct, setDescontoPct] = useState(0);
  const descontoAplicado = ehRep ? descontoPct : 0;

  // Ref crescente e, dentro da mesma ref, a ordem da grade — a mesma ordem do
  // catálogo impresso, que é como o representante confere com o lojista. Sem
  // isso a lista fica na ordem em que as peças foram tocadas, que ninguém acha.
  // A mini foto de cada linha do carrinho — a mesma do catálogo.
  const imagemPorProduto = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allProducts ?? []) if (p.image_url) m.set(p.id, p.image_url);
    return m;
  }, [allProducts]);

  const itensOrdenados = [...items].sort(
    (a, b) => compararReferencia(a.sku, b.sku) || compararTamanho(a.size, b.size),
  );

  // Um card por (referência × cor), com a grade de tamanhos junta — a cor faz
  // parte da identidade da linha (3 azuis M ≠ 2 rosas M), então cores
  // diferentes da mesma ref viram cards separados de propósito.
  const gruposDoCarrinho = (() => {
    const porGrupo = new Map<string, typeof itensOrdenados>();
    for (const item of itensOrdenados) {
      const chave = `${item.product_id}|${item.color_code ?? ''}`;
      const lista = porGrupo.get(chave);
      if (lista) lista.push(item);
      else porGrupo.set(chave, [item]);
    }
    return [...porGrupo.entries()].map(([chave, itens]) => ({ chave, itens }));
  })();

  const totalBruto = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const total = totalBruto * (1 - descontoAplicado / 100);
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);

  // O que ainda falta para poder enviar o pedido (cliente é o mais esquecido:
  // a pessoa chega com produtos no carrinho vindo do catálogo e não seleciona cliente).
  const missingReason = reprecificando
    ? 'Ajustando os preços para a tabela deste cliente…'
    : !customerId && !ehLoja
      ? 'Selecione o cliente para enviar o pedido.'
      : items.length === 0
      ? 'Adicione ao menos um produto para enviar o pedido.'
      : selectedCustomer?.blocked
        ? 'Este cliente está bloqueado. Escolha outro para continuar.'
        : null;

  /**
   * O botão não envia direto: abre a confirmação da tabela.
   *
   * Cadastro errado só aparece na fatura, e aí o pedido já foi para a fábrica.
   * Ler o nome da tabela antes de enviar é o único momento barato de pegar isso.
   */
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((!customerId && !ehLoja) || items.length === 0 || !user) return;
    if (confirmacaoDaTabela) {
      setConfirmando(true);
      return;
    }
    void enviarPedido();
  };

  const enviarPedido = async () => {
    if ((!customerId && !ehLoja) || items.length === 0 || !user) return;
    setConfirmando(false);
    setSubmitting(true);

    // Offline a loja não tem quem carimbe o cliente por ela: vai o customer_id
    // que veio no login.
    const clienteDoPedido = ehLoja ? (user.customer_id ?? '') : customerId;

    const local_id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload: CreateOrderRequest = {
      ...(ehLoja ? {} : { customer_id: customerId }),
      // O ERP recebe o item como sortido; a cor escolhida viaja na observação,
      // logo abaixo do que o representante digitou.
      notes: juntarObservacao(notes, observacaoDeCores(items)),
      // A condição escolhida (rep ou loja). Vai para o pedido, o e-mail e o
      // COND PGTO da planilha do Control.
      ...(condicaoId ? { payment_condition_id: condicaoId } : {}),
      // A % fechada com o lojista. Só o rep manda; o servidor descarta dos outros.
      ...(descontoAplicado > 0 ? { discount_percent: descontoAplicado } : {}),
      local_id,
      // O pedido do representante nasce RASCUNHO, de propósito — pedido do Yan
      // (14/08/2026): "não mandar direto". Ele fica na área "Enviar pra
      // fábrica" da lista, onde a Simone confere e altera com calma, e só vai
      // para a fila do gerente quando ela mandar. (Para a loja o servidor
      // ignora este campo: pedido dela nunca é rascunho, cai na triagem.)
      submit: false,
      items: items.map(({ product_id, variant_id, quantity, unit_price }) => ({
        product_id,
        variant_id: variant_id ?? undefined,
        quantity,
        unit_price,
      })),
    };

    try {
      if (isOnline && token) {
        await api.post<ApiResponse<OrderWithItems>>('/orders', payload, token);
        setToast({
          message: ehLoja
            ? 'Pedido enviado ao seu representante!'
            : 'Pedido salvo! Ele está em "Enviar pra fábrica" — mande quando conferir.',
          type: 'success',
        });
      } else {
        await addToSyncQueue({
          local_id,
          customer_id: clienteDoPedido,
          notes: notes || undefined,
          payment_condition_id: condicaoId || undefined,
          discount_percent: descontoAplicado > 0 ? descontoAplicado : undefined,
          items: payload.items,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setToast({ message: 'Pedido salvo offline. Será sincronizado ao reconectar.', type: 'info' });
      }
      clearCart();
      setDescontoPct(0);
      setTimeout(() => void navigate('/orders'), 1500);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Erro ao criar pedido', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Mesma visibilidade do catálogo: só produtos com foto (refs que foram tiradas
  // do catálogo não devem aparecer na busca de pedido).
  //
  // Havia aqui um `!/^2/.test(p.sku)` para excluir a Plumene. Saiu junto com o
  // do catálogo: os 2xxx da Plumene já estão inativos, e o prefixo escondia 4
  // referências ativas da própria casa — o rep via a peça e não conseguia
  // lançá-la no pedido. Ver o comentário em PaginaCatalogo.tsx.
  const availableProducts = activeProducts.filter((p) => !!p.image_url);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Novo pedido</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        {ehLoja
          ? 'Monte o pedido e envie. Seu representante confere antes de ir para a fábrica.'
          : 'Escolha o cliente e as peças. O pedido fica salvo em "Enviar pra fábrica" até você mandar.'}
      </p>

      {!isOnline && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground">
          <WifiOff className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          Você está offline. O pedido será salvo localmente e sincronizado depois.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {!ehLoja && (
          <div className="space-y-1.5">
            <label htmlFor="customer" className="text-sm font-medium text-foreground">
              Cliente <span className="text-danger">*</span>
            </label>
            <SearchSelect
              id="customer"
              value={customerId}
              onSelect={setCustomerId}
              placeholder="Selecione um cliente"
              searchPlaceholder="Buscar cliente por nome ou CNPJ…"
              emptyText="Nenhum cliente encontrado"
              options={(customers ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                sublabel: c.cnpj ? `CNPJ ${c.cnpj}` : undefined,
              }))}
            />
            {selectedCustomer?.blocked ? (
              <p className="text-xs text-danger">Este cliente está bloqueado.</p>
            ) : !customerId ? (
              <p className="text-xs text-muted-foreground">
                Comece escolhendo o cliente — o pedido é sempre vinculado a um cliente.
              </p>
            ) : null}
          </div>
        )}

        {condicoes.length > 0 && (
          <div className="space-y-1.5">
            <label htmlFor="payment-condition" className="text-sm font-medium text-foreground">
              Condição de pagamento
            </label>
            <SearchSelect
              id="payment-condition"
              value={condicaoId}
              onSelect={setCondicaoId}
              placeholder="Buscar condição (ex.: 30/60/90)…"
              searchPlaceholder="Digite os prazos ou o código…"
              emptyText="Nenhuma condição encontrada"
              options={condicoes.map((c) => ({
                value: c.id,
                label: c.description,
                sublabel: `Código ${c.code}`,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              {condicaoId
                ? 'Vai no pedido, no e-mail e na planilha da fábrica.'
                : 'Opcional. Sem escolha, a fábrica define no lançamento.'}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="add-product" className="text-sm font-medium text-foreground">
            Adicionar produto
          </label>
          <SearchSelect
            id="add-product"
            onSelect={addItem}
            resetOnSelect
            disabled={availableProducts.length === 0}
            placeholder={availableProducts.length === 0 ? 'Nenhum produto disponível' : 'Buscar produto para adicionar…'}
            searchPlaceholder="Buscar por nome ou código (SKU)…"
            emptyText="Nenhum produto encontrado"
            options={availableProducts.map((p) => ({
              value: p.id,
              label: p.name,
              sublabel: p.sku,
            }))}
          />
          <p className="text-xs text-muted-foreground">
            Dica: você também pode adicionar itens direto pelo Catálogo.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {gruposDoCarrinho.map(({ chave, itens }) => {
              const primeiro = itens[0]!;
              const subtotal = itens.reduce((s, i) => s + i.quantity * i.unit_price, 0);
              const precos = [...new Set(itens.map((i) => i.unit_price))];
              return (
                <li key={chave} className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="h-16 w-10 shrink-0 overflow-hidden rounded-lg bg-sunken">
                        {imagemPorProduto.get(primeiro.product_id) ? (
                          <img
                            src={imagemPorProduto.get(primeiro.product_id)}
                            alt={primeiro.product_name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-primary/40">
                            <ShoppingCart className="h-4 w-4" strokeWidth={1.5} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {primeiro.product_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {primeiro.sku}
                          {primeiro.color_name && (
                            <>
                              {' · '}
                              <span className="font-medium text-primary">{primeiro.color_name}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        for (const i of itens) removeItem(i.product_id, i.size, i.color_code);
                      }}
                      aria-label="Remover referência do pedido"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* A grade junta: uma coluna por tamanho, com o tamanho em
                      destaque. O − no 1 tira o tamanho da grade. */}
                  <div className="flex flex-wrap items-end gap-2">
                    {itens.map((item) => (
                      <div
                        key={item.size}
                        className="flex flex-col items-center gap-1 rounded-lg border border-primary/25 bg-primary-soft px-1.5 pb-1.5 pt-1"
                      >
                        <span className="text-xs font-bold uppercase tracking-wide text-primary">
                          {item.size || 'Único'}
                        </span>
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() =>
                              item.quantity <= 1
                                ? removeItem(item.product_id, item.size, item.color_code)
                                : setQuantity(item.product_id, item.size, item.quantity - 1, item.color_code)
                            }
                            aria-label={`Diminuir quantidade do ${item.size}`}
                            className="flex h-9 w-9 items-center justify-center rounded-l-md border border-input bg-background text-foreground transition-colors hover:bg-muted"
                          >
                            <Minus className="h-3 w-3" strokeWidth={2.5} />
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) =>
                              setQuantity(item.product_id, item.size, Number(e.target.value), item.color_code)
                            }
                            aria-label={`Quantidade do ${item.size}`}
                            className="tnum h-9 w-10 border-y border-input bg-background text-center text-sm font-bold text-foreground focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setQuantity(item.product_id, item.size, item.quantity + 1, item.color_code)
                            }
                            aria-label={`Aumentar quantidade do ${item.size}`}
                            className="flex h-9 w-9 items-center justify-center rounded-r-md border border-input bg-background text-foreground transition-colors hover:bg-muted"
                          >
                            <Plus className="h-3 w-3" strokeWidth={2.5} />
                          </button>
                        </div>
                        {/* Preço por tamanho só quando difere na ref (faixa maior). */}
                        {precos.length > 1 && (
                          <span className="tnum text-[10px] text-muted-foreground">
                            {formatBRL(item.unit_price)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-[6rem]">
                      <label className="mb-1 block text-xs text-muted-foreground">Preço unit.</label>
                      {canEditPrice ? (
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={precos.length === 1 ? (precos[0] ?? 0) : ''}
                          placeholder={
                            precos.length > 1
                              ? `${formatBRL(Math.min(...precos))}–${formatBRL(Math.max(...precos))}`
                              : undefined
                          }
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            for (const i of itens) setUnitPrice(i.product_id, i.size, v, i.color_code);
                          }}
                          className="h-11 w-36 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      ) : (
                        <p className="flex h-11 items-center text-sm font-medium text-foreground">
                          {precos.length === 1
                            ? formatBRL(precos[0] ?? 0)
                            : `${formatBRL(Math.min(...precos))}–${formatBRL(Math.max(...precos))}`}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {itens.reduce((s, i) => s + i.quantity, 0)} peças · Subtotal
                      </p>
                      <p className="text-sm font-semibold text-foreground">{formatBRL(subtotal)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1.5">
          <label htmlFor="notes" className="text-sm font-medium text-foreground">
            Observações
          </label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Opcional"
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          {/* O desconto mora junto do total: é a última coisa que o rep ajusta
              com o lojista antes de enviar. Vai para o DESC % da planilha da
              fábrica — os preços das peças não mudam. */}
          {ehRep && items.length > 0 && (
            <div className="mb-3 border-b border-border pb-3">
              <CampoDesconto
                bruto={totalBruto}
                percentual={descontoPct}
                onAplicar={(d) =>
                  setDescontoPct(
                    d.valor != null
                      ? totalBruto > 0
                        ? Number(((d.valor / totalBruto) * 100).toFixed(6))
                        : 0
                      : (d.percent ?? 0),
                  )
                }
              />
            </div>
          )}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {/* PEÇAS: é o número que o representante confere com o lojista e
                  que a fábrica lê no romaneio. As referências vêm ao lado. */}
              <span className="tnum font-semibold text-foreground">{totalQty}</span>{' '}
              {totalQty === 1 ? 'peça' : 'peças'} · {items.length} ref.
              {descontoAplicado > 0 && (
                <span className="tnum ml-2 text-positive">
                  −{formatBRL(totalBruto - total)}
                </span>
              )}
            </span>
            <span className="text-xl font-bold text-foreground">{formatBRL(total)}</span>
          </div>
          {missingReason && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>{missingReason}</span>
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting || missingReason !== null}
          >
            {submitting
              ? 'Salvando…'
              : !isOnline
                ? 'Salvar offline'
                : ehLoja
                  ? 'Enviar ao meu representante'
                  : 'Salvar pedido'}
          </Button>
        </div>
      </form>

      {picker && (
        <SeletorTamanho
          product={picker.product}
          colorGroup={picker.group.length > 1 ? picker.group : undefined}
          onClose={() => setPicker(null)}
          onConfirm={(chosen, lines) =>
            lines.forEach((l) =>
              addToCart({
                product_id: chosen.id,
                variant_id: l.variant_id,
                size: l.size,
                product_name: chosen.name,
                sku: chosen.sku,
                quantity: l.quantity,
                // O EG e a grade plus custam mais na tabela da fábrica. A API
                // recalcula tudo no envio; isto é para a tela e o total baterem
                // com o que vai ser cobrado.
                unit_price: precoDoTamanho(l.size, chosen.price, chosen.price_larger) ?? 0,
                color_code: l.color_code ?? null,
                color_name: l.color_name ?? null,
              }),
            )
          }
        />
      )}

      {confirmando && confirmacaoDaTabela && (
        <ConfirmarTabela
          titulo={confirmacaoDaTabela.titulo}
          detalhe={confirmacaoDaTabela.detalhe}
          tabela={confirmacaoDaTabela.tabela}
          rotuloConfirmar={confirmacaoDaTabela.rotuloConfirmar ?? `Sim, enviar`}
          ocupado={submitting}
          onConfirmar={() => void enviarPedido()}
          onCancelar={() => setConfirmando(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
