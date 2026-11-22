# Codeflow 1.1.1

Mod para Claude Code que mede o turno principal e oferece uma opção para reduzir a saída de leituras e buscas que chega ao contexto. Funciona em sessões normais e pode acompanhar o [Code Mode nativo](https://code.claude.com/docs/en/code-mode).

## Abrir uma sessão

```bash
claude --plugin-dir ./codeflow
CLAUDE_CODEFLOW_ENABLED=1 claude --plugin-dir ./codeflow
```

O primeiro comando abre no **modo passivo**, que coleta telemetria. O segundo abre no **modo ativo**, que acrescenta orientação ao prompt, reduz resultados elegíveis de `Read`, `Grep` e `Glob` e sinaliza padrões sensíveis em `Bash` e `REPL`. A variável é lida do ambiente ao iniciar. Ausência, valor inválido ou `0` mantém o modo passivo.

A redução se aplica à representação textual de resultados bem-sucedidos no transcript. A resposta entregue ao executor permanece inteira. Saídas de shell, testes, efeitos de escrita e resultados que contenham mídia ficam fora dessa redução. Se precisar de conteúdo omitido, refaça a leitura com um intervalo ou refine a busca.

A guarda sinaliza operações por padrões literais e preserva as recusas e pedidos de aprovação existentes. Use as regras nativas `ask` e `deny` para as operações que precisam de controle. Confira o código do executor nativo com `Ctrl+O`. [Permissões no Code Mode](https://code.claude.com/docs/en/code-mode#permission-checks)

## Comandos

| Comando | Resultado |
| --- | --- |
| `/codeflow` | Estado do modo |
| `/codeflow report` | Requisições, chamadas, tokens, tempo, contexto e custo estimado quando disponíveis |
| `/codeflow pensamento` | Contagem de blocos e palavras no último turno, com a opção `thinking` habilitada |
| `/codeflow stash <nome> <texto>` | Guarda texto escolhido no terminal em memória por até 30 minutos, no modo ativo |
| `/codeflow recall <nome>` | Mostra o valor guardado |
| `/codeflow forget <nome>` | Remove a entrada |

O stash aceita até 20 entradas de até 2.000 caracteres. Ele é limpo ao encerrar ou limpar a sessão. O texto digitado em comandos pode aparecer no histórico da sessão do Claude.

## Medição e armazenamento

A contagem de eventos é a mesma nos dois modos. Entrada total soma entrada sem cache, cache lido e cache criado. A contagem de requisições com múltiplas ferramentas usa a resposta da etapa do modelo. Os relatórios exibem a duração de turnos concluídos e mostram o total de turnos observados. Campos indisponíveis aparecem como tal.

Por padrão, a coleta fica em memória. Defina `CLAUDE_CODEFLOW_RUN` se quiser agrupar sessões para uma comparação. O registro usa uma chave por sessão e inclui somente dados de telemetria. O relatório usa sessões encerradas nas últimas 24 horas com o mesmo ID de experimento. Veja o [procedimento A/B](docs/teste-hibrido-ab.md).

As opções abaixo ficam na configuração do plugin.

| Opção | Padrão |
| --- | --- |
| `maxFileLines` | 200 |
| `maxToolResultChars` | 2.000. Valores abaixo de 64 usam o padrão. |
| `maxListItems` | 20 |
| `guardPatterns` | Vazio. Padrões adicionais separados por vírgula. |
| `turnSummary` | Ligado |
| `thinking` | Desligado. Quando ativo guarda contagens. |
| `sessionLog` | Desligado. Quando ativo grava um resumo em `.codeflow/session-<id>.ndjson` ao sair. |

## Validar o pacote local

```bash
claude plugin validate ./codeflow
claude plugin test ./codeflow
```

Os testes usam o ambiente simulado do Claude Code. Para medir uma tarefa real, use o mesmo projeto de teste e verifique o resultado em cada modo. Há um [cenário de exemplo](docs/cenario-landing-page.md).
