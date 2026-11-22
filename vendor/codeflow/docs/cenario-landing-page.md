# Cenário de teste — landing page

Crie uma pasta descartável, abra uma sessão com `CLAUDE_CODEFLOW_ENABLED=1` e carregue o mod como descrito no README. Em outro par, rode a mesma tarefa no modo passivo a partir do mesmo estado.

> Crie uma página responsiva para o app fictício Bolso. Use index.html, styles.css e app.js. Inclua uma chamada principal, uma seção de benefícios, rodapé e um formulário de e-mail com validação. Rode um servidor local e confirme que a página abre.

Em turnos separados, peça uma verificação de links e uma mudança na cor primária. Se quiser testar o stash, use `/codeflow stash links 3 links internos válidos` e `/codeflow recall links`. O texto escolhido fica em memória durante a sessão.

## Critérios

- A página abre, o formulário responde e o diff mostra as alterações esperadas.
- `/codeflow report` mostra tempo e chamadas dos turnos concluídos. Contexto, tokens e custo aparecem quando o Claude os informa.
- Uma leitura ser reduzida depende do volume e da representação da ferramenta. Faça uma leitura direcionada para conferir dados omitidos.
- No modo passivo a mesma coleta continua, e a saída original da leitura chega ao transcript.
