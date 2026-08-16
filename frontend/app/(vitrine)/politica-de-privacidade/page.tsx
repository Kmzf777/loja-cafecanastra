import type { Metadata } from "next";
import { PaginaTexto, AvisoJuridico } from "@/components/layout/PaginaTexto";

export const metadata: Metadata = {
  title: "Política de privacidade — Café Canastra",
  description: "Quais dados coletamos, por que, e como você pede para apagá-los.",
};

export default function PoliticaDePrivacidade() {
  return (
    <PaginaTexto titulo="Política de privacidade" atualizacao="agosto de 2026">
      <AvisoJuridico />

      <h2>O que coletamos</h2>
      <ul>
        <li>Nome, e-mail, CPF e telefone, para emitir a nota e acompanhar o pedido.</li>
        <li>Endereço, para calcular o frete e entregar.</li>
        <li>
          Dados de navegação (páginas vistas, itens na sacola), para manter a
          sacola entre visitas e entender o que precisa melhorar.
        </li>
      </ul>
      <p>
        Não guardamos número de cartão. O pagamento é processado pelo Mercado
        Pago, que recebe esses dados diretamente.
      </p>

      <h2>Por que coletamos</h2>
      <p>
        Para executar a compra que você pediu, cumprir obrigações fiscais e, com
        seu consentimento, mandar novidades por e-mail. Você pode retirar o
        consentimento de e-mail a qualquer momento, sem afetar suas compras.
      </p>

      <h2>Com quem compartilhamos</h2>
      <ul>
        <li>Mercado Pago — processamento do pagamento.</li>
        <li>Melhor Envio e transportadoras — cálculo de frete e entrega.</li>
        <li>Serviço de e-mail transacional — avisos de status do pedido.</li>
      </ul>
      <p>Não vendemos seus dados para ninguém.</p>

      <h2>Cookies</h2>
      <p>
        Usamos cookies necessários para manter você conectado e guardar a sacola.
        Cookies de medição só são usados se você aceitar no aviso que aparece na
        primeira visita.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Pela LGPD, você pode pedir acesso, correção, portabilidade ou exclusão
        dos seus dados, e saber com quem foram compartilhados. Pedidos podem ser
        feitos pelo canal de contato do rodapé e são respondidos em até 15 dias.
      </p>
      <p>
        Alguns dados precisam ser mantidos mesmo após um pedido de exclusão,
        quando há obrigação fiscal — nota fiscal, por exemplo, tem prazo legal de
        guarda.
      </p>
    </PaginaTexto>
  );
}
