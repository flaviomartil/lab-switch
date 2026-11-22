# Lab Switch

Dois terminais Claude Code reais em uma página local. O experimental fica à esquerda. A sessão de controle usa outro perfil e outra cópia do projeto.

## Abrir

Instale as dependências com Node.js 22 ou superior e abra o CLI.

```bash
npm ci
npm start
```

Acesse http://127.0.0.1:4178. O item padrão é o Codeflow 1.1.1 incluído. À esquerda ele roda em modo passivo e exibe a telemetria. À direita o Claude roda sem carregar o pacote. O campo compartilhado envia quando os dois editores de prompt estão prontos. Cada terminal também aceita teclado e confirmações individualmente.

Os dois processos do Claude iniciam com `--dangerously-skip-permissions`. Use o Lab com projetos e extensões confiáveis. Os processos usam os privilégios da conta local. A interface envia pelo campo compartilhado assim que os dois editores estiverem prontos, independentemente do foco.

## Rodadas

O painel **Rodadas** fica abaixo do prompt e lista os envios compartilhados. Ao enviar, a rodada nova é selecionada e acompanhada ao vivo.

A aba **Comparação** mostra o prompt, as métricas de cada lado com a diferença entre eles e as duas respostas visíveis. As métricas vêm do transcript nativo de cada Claude, inclusive no lado sem Codeflow: modo efetivo, modelo, tempo, tokens (entrada nova, cache lido e criado, saída), requisições, chamadas e erros de ferramentas. O modo efetivo pode mudar durante a sessão pelo atalho do Claude.

Os dados ficam em `~/Library/Application Support/Lab Switch/history` no Mac e em `${XDG_STATE_HOME:-~/.local/state}/lab-switch/history` no Linux. `--history-dir` aponta para outro diretório. O histórico guarda o texto do campo compartilhado, as respostas visíveis e os prints. Mantenha esse diretório privado.

## Preview

Quando um terminal imprime uma URL local (`localhost`, `127.0.0.1`, `0.0.0.0` ou `[::1]` com porta), a aba **Preview** abre essa página ao lado da página do outro terminal. A aba abre sozinha no primeiro servidor que surge depois de um envio. **Abrir** leva a página para outra aba e **Recarregar** atualiza o quadro.

Os dois terminais compartilham as portas da máquina. Se os dois tentarem a mesma porta, um servidor falha e o Claude desse lado pode acabar conferindo a página do outro. Por isso cada preview indica quem está escutando na porta, pelo `lsof`:

| Etiqueta | Significado |
|---|---|
| servido por este terminal | O processo na porta roda dentro da cópia deste lado |
| servido pelo outro terminal | O servidor deste lado não subiu e a página mostrada é a do outro |
| porta de outro processo | A porta pertence a algo fora do Lab |

Para evitar a disputa, peça portas diferentes para cada lado no prompt.

## Prints

Quando os dois lados terminam a rodada, o Lab tira um print de cada preview e guarda junto do histórico. Ao abrir uma rodada antiga, a Comparação mostra esses prints com a etiqueta de quem servia a página, em vez de reabrir a página ao vivo. Clicar no print abre a imagem em tamanho cheio.

O print usa o Chrome, Chromium, Edge ou Brave instalado, em modo headless. `LAB_BROWSER` aponta para outro executável compatível. Sem navegador, a rodada é salva sem print.

## Login

O laboratório reaproveita um token OAuth válido da instalação local do Claude Code ou do Keychain padrão do Mac quando acessível. Também aceita `CLAUDE_CODE_OAUTH_TOKEN` ou `ANTHROPIC_API_KEY` fornecidos ao CLI pelo ambiente. Cada par recebe a mesma autenticação, com configurações, extensões e projetos isolados. A autenticação reaproveitada é repassada aos processos do Claude e o laboratório mantém o token fora dos arquivos e do navegador. Se a credencial reaproveitada expirar, inicie um novo par após renovar o login na instalação principal. Cada perfil já vem com tema definido, onboarding concluído e a cópia do projeto marcada como confiável, então os terminais abrem direto no prompt.

Se o Lab for iniciado por SSH, o Keychain do Mac costuma ficar inacessível e os terminais mostram `Not logged in`. Inicie pelo Terminal do próprio Mac ou forneça uma credencial oficial no ambiente do launcher. Veja a [documentação de autenticação do Claude Code](https://code.claude.com/docs/en/authentication).

## Outros itens

A opção `--demo` permite testar a interface com processos de demonstração. A página identifica esse modo. A opção `--model` aplica a mesma escolha aos dois lados.

```bash
npm start -- --demo
npm start -- --model sonnet --port 4180
npm start -- --kind mod --item /caminho/codeflow --project /caminho/projeto
```

`--kind` aceita `mod` (pasta ou ZIP), `skill` (pasta com SKILL.md ou o arquivo), `hook` (JSON de settings com a chave hooks), `mcp` (JSON com mcpServers) e `agent` (JSON de agentes para --agents). `--code-mode` pede o Code Mode nativo em ambos. `--active-codeflow` também ativa filtros e guarda no lado experimental, para um teste separado. `--claude-bin` aponta para um executável específico.

## Dados locais

Cada lado recebe um HOME, um CLAUDE_CONFIG_DIR e um diretório de trabalho isolados. Novo par cria novas cópias do projeto e mantém os perfis descartáveis do servidor. Encerrar finaliza os dois processos. Encerre o servidor com Ctrl+C para apagar os perfis do laboratório. O servidor aceita conexões de loopback com a origem local esperada. Use extensões e projetos confiáveis, pois os binários rodam com a conta do usuário e as políticas gerenciadas do Claude continuam valendo.

`npm test` exercita os dois PTYs, o envio em múltiplas linhas, o bypass de permissões, a gravação do histórico, a detecção de preview com as cores ANSI do vite, o print com um navegador falso, o encerramento e a recusa de origem externa. Os testes usam a demonstração determinística.
