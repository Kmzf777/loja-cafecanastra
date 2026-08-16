"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import { useSacola } from "@/lib/sacola/sacola";
import { formatarPreco } from "@/lib/catalogo/repositorio";
import { recuperarSessao, type Sessao } from "@/lib/conta/sessao";
import {
  buscarEndereco,
  salvarEndereco,
  cotarFrete,
  pagarComPix,
  type Endereco,
  type OpcaoDeFrete,
  type RespostaDoPagamento,
} from "@/lib/sacola/checkout";

/**
 * Checkout.
 *
 * Três passos numa página só, porque o pedido é curto: endereço → frete →
 * pagamento. Nada de assistente com etapas separadas — a cada tela extra some
 * gente no meio do caminho.
 *
 * PAGAMENTO POR PIX. Cartão exige tokenizar o número no navegador com o SDK do
 * Mercado Pago e uma chave pública (MP_PUBLIC_KEY), que este projeto ainda não
 * tem configurada; o backend já aceita cartão pelo mesmo endpoint quando o
 * `formData.token` chegar. Oferecer um botão de cartão que não tokeniza seria
 * repetir o problema que este trabalho veio consertar — botão que não faz nada.
 *
 * O QUE ESTA TELA *NÃO* DECIDE: preço, frete e estoque. Ela sugere; o servidor
 * relê tudo do banco, reconfere o frete contra uma cotação nova e só então
 * cobra. Ver conferirFrete e a reserva de estoque em PaymentController.
 */

const CAMPO =
  "h-11 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

const ENDERECO_VAZIO: Endereco = {
  zip_code: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

export default function PaginaCheckout() {
  const router = useRouter();
  const { itens, totalCentavos, limpar } = useSacola();

  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [endereco, setEndereco] = useState<Endereco>(ENDERECO_VAZIO);
  const [fretes, setFretes] = useState<OpcaoDeFrete[] | null>(null);
  const [freteEscolhido, setFreteEscolhido] = useState<OpcaoDeFrete | null>(null);
  const [cotando, setCotando] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pago, setPago] = useState<RespostaDoPagamento | null>(null);

  // Comprar exige conta: o pedido precisa de dono, e o CPF do cadastro é
  // obrigatório para a nota. Quem não está logado vai para o login e volta.
  useEffect(() => {
    let vivo = true;
    recuperarSessao().then(async (s) => {
      if (!vivo) return;
      if (!s) {
        router.replace("/account/login?de=/checkout");
        return;
      }
      setSessao(s);
      const salvo = await buscarEndereco(s.accessToken);
      if (salvo && vivo) setEndereco({ ...ENDERECO_VAZIO, ...salvo });
      if (vivo) setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [router]);

  async function aoCotar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!sessao) return;
    setErro(null);
    setCotando(true);
    setFretes(null);
    setFreteEscolhido(null);
    try {
      await salvarEndereco(sessao.accessToken, endereco);
      const opcoes = await cotarFrete(endereco.zip_code, itens);
      setFretes(opcoes);
      if (opcoes.length) setFreteEscolhido(opcoes[0]);
      else setErro("Nenhuma transportadora atende este CEP no momento.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao calcular o frete.");
    } finally {
      setCotando(false);
    }
  }

  async function aoPagar() {
    if (!sessao || !freteEscolhido) return;
    setErro(null);
    setPagando(true);
    try {
      const resposta = await pagarComPix(sessao.accessToken, {
        itens,
        email: sessao.usuario.email,
        endereco,
        frete: freteEscolhido,
      });
      setPago(resposta);
      // A sacola só é esvaziada depois do pagamento aceito: se falhar, a pessoa
      // não perde o que montou.
      await limpar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o Pix.");
    } finally {
      setPagando(false);
    }
  }

  if (carregando) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <p role="status" className="text-[15px] text-fuligem-55">
          Carregando…
        </p>
      </div>
    );
  }

  // ── Pedido criado ────────────────────────────────────────────────────────
  if (pago) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
        <h1 className="font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1]">
          Pedido recebido.
        </h1>
        <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-fuligem-80">
          Pedido{" "}
          <span className="font-dado">{pago.orderId.slice(0, 8)}</span>. Assim
          que o Pix for compensado, o café entra na próxima torra.
        </p>
        {pago.ticketUrl ? (
          <div className="mt-8">
            <a
              href={pago.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-bt bg-vermelho px-6 text-[13px] font-semibold uppercase tracking-[0.08em] text-white hover:bg-vermelho-esc"
            >
              Abrir o Pix para pagar
            </a>
          </div>
        ) : null}
        <p className="mt-10 text-[14px]">
          <Link
            href="/account"
            className="text-vermelho underline underline-offset-4"
          >
            Ver meus pedidos
          </Link>
        </p>
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
        <h1 className="font-titulo text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          Sua sacola está vazia.
        </h1>
        <div className="mt-8">
          <BotaoLink href="/cafes" variante="primario">
            Ver os cafés
          </BotaoLink>
        </div>
      </div>
    );
  }

  const total = totalCentavos + Math.round((freteEscolhido?.price ?? 0) * 100);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Fechar pedido
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Checkout
      </h1>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div>
          {/* ── Endereço ────────────────────────────────────────────────── */}
          <form onSubmit={aoCotar}>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              Entrega
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cep" className={ROTULO}>
                  CEP
                </label>
                <input
                  id="cep"
                  required
                  inputMode="numeric"
                  value={endereco.zip_code}
                  onChange={(e) =>
                    setEndereco({ ...endereco, zip_code: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5 font-dado`}
                />
              </div>
              <div>
                <label htmlFor="rua" className={ROTULO}>
                  Rua
                </label>
                <input
                  id="rua"
                  required
                  value={endereco.street}
                  onChange={(e) =>
                    setEndereco({ ...endereco, street: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="numero" className={ROTULO}>
                  Número
                </label>
                <input
                  id="numero"
                  required
                  value={endereco.number}
                  onChange={(e) =>
                    setEndereco({ ...endereco, number: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="complemento" className={ROTULO}>
                  Complemento
                </label>
                <input
                  id="complemento"
                  value={endereco.complement ?? ""}
                  onChange={(e) =>
                    setEndereco({ ...endereco, complement: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="bairro" className={ROTULO}>
                  Bairro
                </label>
                <input
                  id="bairro"
                  required
                  value={endereco.neighborhood}
                  onChange={(e) =>
                    setEndereco({ ...endereco, neighborhood: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div className="grid grid-cols-[1fr_88px] gap-4">
                <div>
                  <label htmlFor="cidade" className={ROTULO}>
                    Cidade
                  </label>
                  <input
                    id="cidade"
                    required
                    value={endereco.city}
                    onChange={(e) =>
                      setEndereco({ ...endereco, city: e.target.value })
                    }
                    className={`${CAMPO} mt-1.5`}
                  />
                </div>
                <div>
                  <label htmlFor="uf" className={ROTULO}>
                    UF
                  </label>
                  <input
                    id="uf"
                    required
                    maxLength={2}
                    value={endereco.state}
                    onChange={(e) =>
                      setEndereco({
                        ...endereco,
                        state: e.target.value.toUpperCase(),
                      })
                    }
                    className={`${CAMPO} mt-1.5 uppercase`}
                  />
                </div>
              </div>
            </div>

            <Botao
              type="submit"
              variante="secundario"
              disabled={cotando}
              className="mt-6"
            >
              {cotando ? "Calculando…" : "Calcular frete"}
            </Botao>
          </form>

          {/* ── Frete ───────────────────────────────────────────────────── */}
          {fretes?.length ? (
            <fieldset className="mt-10">
              <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
                Entrega
              </legend>
              <div className="mt-4 grid gap-2">
                {fretes.map((f) => (
                  <label
                    key={`${f.id}-${f.name}`}
                    className={`flex cursor-pointer items-center justify-between gap-4 border px-4 py-3 transition-colors ${
                      freteEscolhido?.id === f.id
                        ? "border-fuligem"
                        : "border-fuligem-20 hover:border-fuligem"
                    }`}
                  >
                    <span className="flex items-center gap-3 text-[14px]">
                      <input
                        type="radio"
                        name="frete"
                        checked={freteEscolhido?.id === f.id}
                        onChange={() => setFreteEscolhido(f)}
                        className="accent-[var(--color-vermelho)]"
                      />
                      {f.name}
                      {f.days ? (
                        <span className="text-fuligem-55">
                          · {f.days} {f.days === 1 ? "dia" : "dias"}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-dado text-[14px]">
                      {f.price > 0 ? formatarPreco(Math.round(f.price * 100)) : "Grátis"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {erro ? (
            <p
              role="alert"
              className="mt-6 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
            >
              {erro}
            </p>
          ) : null}
        </div>

        {/* ── Resumo ─────────────────────────────────────────────────────── */}
        <aside className="h-fit border border-fuligem-20 p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            Resumo
          </h2>

          <ul className="mt-4 space-y-2">
            {itens.map((i) => (
              <li
                key={i.product_id}
                className="flex justify-between gap-3 text-[13px]"
              >
                <span className="min-w-0">
                  {i.quantity}× {i.name}
                </span>
                <span className="shrink-0 font-dado">
                  {formatarPreco(
                    Math.round(Number(i.price) * 100) * Number(i.quantity),
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex justify-between border-t border-fuligem-20 pt-3 text-[14px]">
            <span>Frete</span>
            <span className="font-dado">
              {freteEscolhido
                ? freteEscolhido.price > 0
                  ? formatarPreco(Math.round(freteEscolhido.price * 100))
                  : "Grátis"
                : "—"}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between border-t border-fuligem-20 pt-3">
            <span className="text-[15px] font-semibold">Total</span>
            <span className="font-dado text-[20px]">{formatarPreco(total)}</span>
          </div>

          <div className="mt-6">
            <Botao
              variante="primario"
              disabled={!freteEscolhido || pagando}
              onClick={aoPagar}
              className="w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
            >
              {pagando ? "Gerando Pix…" : "Pagar com Pix"}
            </Botao>
          </div>

          {!freteEscolhido ? (
            <p className="mt-3 text-[13px] text-fuligem-55">
              Calcule o frete para liberar o pagamento.
            </p>
          ) : null}

          <p className="mt-6 text-[13px] text-fuligem-55">
            Pagamento por Pix. Cartão em breve.
          </p>
        </aside>
      </div>
    </div>
  );
}
