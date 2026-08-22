"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import { EncerrarConta } from "@/components/conta/EncerrarConta";
import { WhatsAppDaConta } from "@/components/conta/WhatsAppDaConta";
import {
  API_BASE,
  recuperarSessao,
  sair,
  type Sessao,
} from "@/lib/conta/sessao";
import { formatarPreco } from "@/lib/catalogo/repositorio";
import {
  STATUS_DA_ASSINATURA,
  cancelarAssinatura,
  listarAssinaturas,
  type AssinaturaDaConta,
} from "@/lib/clube";

/**
 * Área da conta.
 *
 * Client-side de propósito: a sessão vive num cookie httpOnly emitido pelo
 * backend Express, que o servidor do Next não tem como ler durante o render.
 * Renderizar no servidor exigiria duplicar a verificação de token no Next —
 * duas fontes de verdade para "quem está logado" é como sessão desincroniza.
 */

type Pedido = {
  order_id: string;
  total_amount: string | number;
  status: string;
  created_at: string;
  payment_method?: string;
  shipping_method?: string;
};

/**
 * Rótulos de exibição por status. Desde a F4 a API fala português
 * (`pendente`, `aprovado`... — o CHECK da migração 0009 é a lista); as chaves
 * em inglês ficam por tolerância a qualquer resposta antiga em cache, porque
 * custam zero e um status sem rótulo apareceria cru na tela.
 */
const STATUS: Record<string, string> = {
  pendente: "Aguardando pagamento",
  em_processamento: "Em análise",
  aprovado: "Pago",
  autorizado: "Autorizado",
  enviado: "Enviado",
  entregue: "Entregue",
  rejeitado: "Recusado",
  cancelado: "Cancelado",
  reembolsado: "Estornado",
  pending: "Aguardando pagamento",
  in_process: "Em análise",
  approved: "Pago",
  authorized: "Autorizado",
  sent: "Enviado",
  delivered: "Entregue",
  rejected: "Recusado",
  cancelled: "Cancelado",
  refunded: "Estornado",
};

export default function PaginaConta() {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Clube (Onda 3J): as assinaturas do dono, e o retorno do Mercado Pago.
  const [assinaturas, setAssinaturas] = useState<AssinaturaDaConta[] | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [erroDoClube, setErroDoClube] = useState<string | null>(null);
  const [voltouDoMp, setVoltouDoMp] = useState(false);

  // A conta acabou de ser excluída (LGPD art. 18, VI — ver EncerrarConta).
  // A partir daqui NADA nesta página funciona: o token morreu junto com a
  // conta, e cada botão que sobrasse na tela responderia 401 ou 403.
  const [contaExcluida, setContaExcluida] = useState(false);

  /**
   * `?painel=negado` — a pessoa tentou abrir /dashboard e o guard de servidor
   * (`lib/conta/painel-servidor.ts`) a mandou para cá.
   *
   * NÃO HÁ PERMANÊNCIA NENHUMA AQUI, e isso é deliberado: é o aviso desta
   * visita, não um estado guardado. Gravar "já foi negado" em storage criaria
   * uma marca que sobreviveria à promoção da conta a gestor — e a pessoa leria
   * "sem acesso" no dia em que passasse a ter.
   */
  const [painelNegado, setPainelNegado] = useState(false);

  // `?assinatura=confirmada` é o back_url do preapproval — a pessoa acabou de
  // autorizar a cobrança no MP. Lido do location (e não de useSearchParams)
  // para não exigir Suspense numa página client-only.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("assinatura") === "confirmada") setVoltouDoMp(true);
    if (params.get("painel") === "negado") setPainelNegado(true);
  }, []);

  useEffect(() => {
    let vivo = true;
    recuperarSessao().then((s) => {
      if (!vivo) return;
      if (!s) {
        router.replace("/account/login?de=/account");
        return;
      }
      setSessao(s);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [router]);

  useEffect(() => {
    if (!sessao) return;
    let vivo = true;
    fetch(`${API_BASE}/my-orders`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${sessao.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => vivo && setPedidos(Array.isArray(d) ? d : (d.orders ?? [])))
      // Lista vazia, não tela quebrada: o histórico é secundário na página.
      .catch(() => vivo && setPedidos([]));
    return () => {
      vivo = false;
    };
  }, [sessao]);

  useEffect(() => {
    if (!sessao) return;
    let vivo = true;
    listarAssinaturas(sessao.accessToken)
      .then((lista) => vivo && setAssinaturas(lista))
      // Lista vazia, não tela quebrada — mesma postura do histórico de pedidos.
      .catch(() => vivo && setAssinaturas([]));
    return () => {
      vivo = false;
    };
  }, [sessao]);

  const aoCancelarAssinatura = useCallback(
    async (assinatura: AssinaturaDaConta) => {
      if (!sessao) return;
      /**
       * Confirmação explícita, com a MESMA frase dos termos de uso e do aviso
       * abaixo da lista. Não é preciosismo de copy: a versão anterior dizia
       * que "os envios param", e os termos prometem que um envio já cobrado é
       * entregue — duas promessas diferentes sobre a mesma ação, e a que o
       * cliente lê na hora de decidir era a errada.
       */
      const confirmou = window.confirm(
        `Cancelar a assinatura de ${assinatura.nome_cafe}? Cancelar interrompe ` +
          "as próximas cobranças na hora; um envio já cobrado é entregue " +
          "normalmente. Sem multa.",
      );
      if (!confirmou) return;
      setErroDoClube(null);
      setCancelando(assinatura.id);
      try {
        await cancelarAssinatura(sessao.accessToken, assinatura.id);
        setAssinaturas(await listarAssinaturas(sessao.accessToken));
      } catch (e) {
        setErroDoClube(
          e instanceof Error ? e.message : "Não foi possível cancelar agora.",
        );
      } finally {
        setCancelando(null);
      }
    },
    [sessao],
  );

  const aoSair = useCallback(async () => {
    await sair();
    router.replace("/");
    router.refresh();
  }, [router]);

  /**
   * Depois da exclusão: derrubar a sessão local e ir para a home.
   *
   * `sair()` é o MESMO que o botão "Sair" usa — nada é reimplementado aqui. Ele
   * ainda importa depois de a conta ter sumido do GoTrue: o cookie do Supabase
   * continua no navegador e o `supabase-js` seguiria tentando renovar um
   * refresh token de uma conta que não existe mais, e o cache de perfil do
   * módulo ainda guardaria o nome de quem acabou de pedir para desaparecer.
   *
   * A NAVEGAÇÃO ESPERA a confirmação ser lida: seis segundos na tela sóbria e
   * então a home. Redirecionar na hora faria a única prova de que deu certo
   * piscar e sumir — e esta é a ação de que a pessoa mais precisa de recibo. O
   * link "Voltar para a loja" está ali para quem não quiser esperar.
   */
  useEffect(() => {
    if (!contaExcluida) return;
    void sair();
    const relogio = setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 6000);
    return () => clearTimeout(relogio);
  }, [contaExcluida, router]);

  if (contaExcluida) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <div className="max-w-[62ch]">
          <h1 className="font-titulo text-[clamp(2rem,4vw,3rem)] leading-[1.05] tracking-[-0.015em]">
            Sua conta foi excluída.
          </h1>
          <p
            role="status"
            className="mt-5 text-[17px] leading-relaxed text-fuligem-80"
          >
            Seu acesso, seus endereços e seus dados pessoais saíram da loja. As
            assinaturas do Clube foram canceladas e seu e-mail saiu da
            newsletter. Os pedidos antigos continuam guardados por obrigação
            fiscal, sem o seu nome.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-fuligem-55">
            Obrigado pelo café que você tomou com a gente. Levamos você de volta
            para a loja em instantes.
          </p>
          <div className="mt-8">
            <BotaoLink href="/" variante="secundario">
              Voltar para a loja
            </BotaoLink>
          </div>
        </div>
      </div>
    );
  }

  if (carregando || !sessao) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <p role="status" className="text-[15px] text-fuligem-55">
          Carregando sua conta…
        </p>
      </div>
    );
  }

  const { usuario } = sessao;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Sua conta
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        {usuario.name}
      </h1>
      <p className="mt-3 font-dado text-[14px] text-fuligem-55">{usuario.email}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <BotaoLink href="/cafes" variante="primario">
          Ver os cafés
        </BotaoLink>
        {/* /dashboard é uma ilha client-only com roteador próprio, mas navegar
            por <Link> monta a ilha do zero e o AuthProvider dela reavalia a
            sessão no efeito de montagem — não precisa de reload completo. */}
        {usuario.role === "admin" ? (
          <BotaoLink href="/dashboard" variante="secundario">
            Abrir o painel
          </BotaoLink>
        ) : null}
        <Botao variante="secundario" onClick={aoSair}>
          Sair
        </Botao>
      </div>

      {/* Chegou aqui empurrado pelo guard do painel. A frase diz o que
          aconteceu e o que fazer — nunca "acesso negado" seco, que soa a
          acusação e não oferece saída. A condição do papel existe porque um
          gestor com este parâmetro na URL (link colado, histórico) leria uma
          informação falsa sobre a própria conta. */}
      {painelNegado && usuario.role !== "admin" ? (
        <p
          role="status"
          className="mt-10 max-w-[62ch] border-l-2 border-alerta bg-cal-puro px-4 py-3 text-[15px] leading-relaxed"
        >
          Esta conta não tem acesso à área de gestão da loja. O painel é
          liberado conta a conta — se o acesso deveria ser seu, fale com quem
          administra a loja.
        </p>
      ) : null}

      {/* O retorno do MP: a autorização aconteceu lá; aqui é a boa notícia.
          O status na lista abaixo pode levar alguns segundos para virar
          "Ativa" — é o webhook do MP quem confirma, não este redirect. */}
      {voltouDoMp ? (
        <p
          role="status"
          className="mt-10 max-w-[62ch] border-l-2 border-mata bg-cal-puro px-4 py-3 text-[15px] leading-relaxed"
        >
          Assinatura autorizada no Mercado Pago. Bem-vindo ao Clube da
          Canastra — o primeiro envio entra na próxima torra, e o status
          aparece abaixo assim que o pagamento confirmar.
        </p>
      ) : null}

      {/* Minha assinatura (Onda 3J): só aparece para quem assina — a página
          da conta é dos pedidos; o convite ao Clube mora em /clube. */}
      {assinaturas && assinaturas.length > 0 ? (
        <section className="mt-16">
          <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
            Minha assinatura
          </h2>
          {erroDoClube ? (
            <p role="alert" className="mt-4 text-[14px] text-vermelho">
              {erroDoClube}
            </p>
          ) : null}
          <ul className="mt-6 border-t border-fuligem-20">
            {assinaturas.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-fuligem-20 py-4"
              >
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">
                    {a.quantidade > 1 ? `${a.quantidade} × ` : ""}
                    {a.nome_cafe}
                  </p>
                  <p className="mt-1 font-dado text-[13px] text-fuligem-55">
                    a cada {a.frequencia_dias} dias ·{" "}
                    {formatarPreco(a.preco_centavos)} por envio
                  </p>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="text-[14px]">
                    {STATUS_DA_ASSINATURA[a.status] ?? a.status}
                  </span>
                  {a.status !== "cancelada" ? (
                    <Botao
                      variante="texto"
                      onClick={() => aoCancelarAssinatura(a)}
                      disabled={cancelando === a.id}
                    >
                      {cancelando === a.id ? "Cancelando…" : "Cancelar"}
                    </Botao>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[14px] text-fuligem-55">
            Cancelar interrompe as próximas cobranças na hora; um envio já
            cobrado é entregue normalmente. Sem multa. O preço de cada
            assinatura fica travado no valor da adesão.
          </p>
        </section>
      ) : null}

      <section className="mt-16">
        <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
          Seus pedidos
        </h2>

        {pedidos === null ? (
          <p className="mt-6 text-[15px] text-fuligem-55">Buscando…</p>
        ) : pedidos.length === 0 ? (
          // §11: tela vazia é convite, nunca "0 resultados".
          <div className="mt-6 max-w-[52ch]">
            <p className="text-[17px] leading-relaxed text-fuligem-80">
              Nenhum pedido ainda. Quando o primeiro sair, ele aparece aqui com o
              código de rastreio.
            </p>
            <div className="mt-6">
              <BotaoLink href="/cafes" variante="secundario">
                Escolher um café
              </BotaoLink>
            </div>
          </div>
        ) : (
          <ul className="mt-6 border-t border-fuligem-20">
            {/* Cada pedido é um link para a página dele (/pedido/[id]) — é lá
                que vivem a linha do tempo, os itens e o rastreio. A linha
                inteira é clicável: um "ver detalhes" minúsculo no canto seria
                alvo de toque ruim. */}
            {pedidos.map((p) => (
              <li key={p.order_id} className="border-b border-fuligem-20">
                <Link
                  href={`/pedido/${p.order_id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 transition-colors hover:bg-cal-puro focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vermelho"
                  aria-label={`Pedido de ${new Date(p.created_at).toLocaleDateString("pt-BR")}, ${STATUS[p.status] ?? p.status}`}
                >
                  <span className="font-dado text-[13px] text-fuligem-55">
                    {new Date(p.created_at).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="text-[14px]">
                    {STATUS[p.status] ?? p.status}
                  </span>
                  <span className="flex items-baseline gap-3 font-dado text-[15px]">
                    {formatarPreco(Math.round(Number(p.total_amount) * 100))}
                    <span aria-hidden className="text-fuligem-55">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* O canal de WhatsApp: convite para quem está sem número, e a
          preferência de promoções para quem já tem. Fica DEPOIS dos pedidos
          porque a página é dos pedidos, e antes de "Encerrar conta" porque
          aquilo tem de continuar sendo a última coisa da página. Ele mesmo
          decide se aparece — ver o cabeçalho do componente. */}
      <WhatsAppDaConta userId={usuario.userId} />

      {/* A porta do direito de eliminação (LGPD art. 18, VI). Fica por último e
          discreta de propósito — ver o cabeçalho do componente. Antes disto, a
          rota `DELETE /auth/users/me` existia sem nenhum chamador vivo e a
          política de privacidade mandava o cliente escrever um e-mail para
          exercer um direito que a loja já sabia cumprir sozinha. */}
      <EncerrarConta
        accessToken={sessao.accessToken}
        aoConcluir={() => setContaExcluida(true)}
      />

      <p className="mt-16 text-[14px] text-fuligem-55">
        <Link href="/" className="text-vermelho underline underline-offset-4">
          Voltar para a loja
        </Link>
      </p>
    </div>
  );
}
