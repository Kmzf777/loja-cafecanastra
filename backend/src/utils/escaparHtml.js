"use strict";

/**
 * Escapa texto para interpolacao em HTML.
 *
 * POR QUE EXISTE: os e-mails deste servico sao montados por template string, e
 * parte do que entra neles e TEXTO ESCRITO PELO CLIENTE — o nome da conta e o
 * nome do item copiado para a sacola. Um cliente que se cadastra como
 * `<img src=x onerror=...>` viraria markup vivo dentro do e-mail de quem o
 * lesse num cliente que renderiza HTML. Nome e dado, nunca marcacao.
 *
 * Os cinco de sempre, na ordem que importa: `&` PRIMEIRO (senao os proprios
 * escapes seriam re-escapados), depois `<`, `>`, `"` e `'` — os dois ultimos
 * porque o texto pode cair dentro de um atributo.
 */
function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { escaparHtml };
