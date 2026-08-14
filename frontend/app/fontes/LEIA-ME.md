# Redaction 35 — pendente

Baixar de https://www.redaction.us (gratuita, Jeremy Mickel / Forest Young),
converter para .woff2 e colocar `Redaction_35-Regular.woff2` nesta pasta.

Depois, trocar a declaracao `--font-titulo` em `app/globals.css` por um
`next/font/local` apontando para o arquivo.

Ate la, os titulos caem no fallback Georgia. Isso e visivel e esperado —
a Redaction so e usada em tamanhos >= 40px (estetica.md §4.2).
