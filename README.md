# AtlasRouter

AtlasRouter e um router OpenAI-compatible para usar varias proxies de IA locais por uma unica API.

Ele foi feito para juntar proxies como DeepSeek, Qwen e Kimi em um endpoint unico, com fallback, health check, supervisor de processos, metricas, alertas, streaming e modelos virtuais como `atlas/auto` e `atlas/compeat`.

O AtlasRouter nao inclui o codigo das proxies. Ele baixa as proxies sob demanda com Git pela CLI `atlas`, deixando o repositorio principal limpo e publicavel.

## Estado atual

Implementado de verdade:

- DeepSeek via `deepsproxy`
- Qwen via `qwenproxy`
- Kimi via `kimiproxy`

Preparado, mas nao integrado de ponta a ponta:

- Mimo
- Z2 API

## Como funciona

O AtlasRouter roda em:

```txt
http://127.0.0.1:3000
```

As proxies rodam separadas:

```txt
DeepSeek -> http://127.0.0.1:3101
Qwen     -> http://127.0.0.1:3102
Kimi     -> http://127.0.0.1:3103
```

Voce usa qualquer app OpenAI-compatible apontando para:

```txt
Base URL: http://127.0.0.1:3000/v1
API Key: vazio ou qualquer coisa, se o app exigir
Model: atlas/auto
```

Quem autentica nas IAs sao as proxies, usando sessao de navegador. O AtlasRouter nao exige API key propria.

## Requisitos

Obrigatorios:

- Node.js 20+
- npm
- Git

Necessario para login das proxies:

- Chromium/Playwright funcionando no sistema
- Login feito no navegador da proxy desejada

## Instalacao do AtlasRouter

```bash
git clone <repo-do-atlasrouter>
cd AtlasRouter
npm install
npm run build
```

Durante desenvolvimento:

```bash
npm run dev
```

Em modo compilado:

```bash
npm start
```

## CLI Atlas

Durante desenvolvimento, use:

```bash
npm run atlas -- <comando>
```

Depois de build/link global, o binario fica:

```bash
atlas <comando>
```

Comandos:

```bash
atlas get deepseek
atlas get qwen
atlas get kimi
atlas get all
atlas list
atlas status
atlas login deepseek
atlas login qwen
atlas login kimi
atlas start
```

No modo local do repositorio, os mesmos comandos ficam:

```bash
npm run atlas -- get deepseek
npm run atlas -- get qwen
npm run atlas -- get kimi
npm run atlas -- get all
npm run atlas -- list
npm run atlas -- login qwen
npm run atlas -- start
```

## Baixando as proxies

Baixar apenas Kimi:

```bash
npm run atlas -- get kimi
```

Baixar DeepSeek e Qwen:

```bash
npm run atlas -- get deepseek qwen
```

Baixar as tres principais:

```bash
npm run atlas -- get all
```

Baixar sem rodar `npm install` dentro da proxy:

```bash
npm run atlas -- get kimi --no-install
```

As proxies sao baixadas para:

```txt
sources/deepsproxy
sources/qwenproxy
sources/kimiproxy
```

Se uma proxy ainda nao foi baixada, o Atlas simplesmente ignora aquele provider ate voce instalar com `atlas get`.

## Login nas IAs

Depois de baixar uma proxy, faca login nela:

```bash
npm run atlas -- login deepseek
```

```bash
npm run atlas -- login qwen
```

```bash
npm run atlas -- login kimi
```

Cada proxy abre ou usa um navegador Playwright para salvar a sessao. Se uma IA parar de responder ou pedir login, rode o login dela de novo.

## Inicializacao normal

Depois de baixar e logar nas proxies desejadas:

```bash
npm run dev
```

O AtlasRouter vai:

- subir na porta `3000`;
- detectar quais proxies existem localmente;
- ignorar proxies nao baixadas;
- detectar proxies ja ligadas;
- subir automaticamente proxies baixadas que nao estao rodando;
- reiniciar proxies gerenciadas se morrerem;
- expor tudo em uma API OpenAI-compatible.

## Supervisor de proxies

O supervisor e ligado por padrao:

```env
ATLAS_SUPERVISOR_ENABLED=true
```

Ele monitora:

- processo da proxy;
- health check;
- porta usada;
- quantidade de starts;
- quantidade de restarts;
- ultimo erro;
- se a proxy foi aberta pelo Atlas ou ja estava aberta antes.

Ver status:

```bash
curl http://localhost:3000/v1/router/supervisor
```

Estados possiveis:

```txt
external   proxy ja estava rodando fora do Atlas
starting   Atlas esta iniciando a proxy
online     proxy foi iniciada pelo Atlas e esta saudavel
offline    proxy nao respondeu
restarting Atlas vai tentar reiniciar
disabled   provider desligado
```

Desligar supervisor:

```env
ATLAS_SUPERVISOR_ENABLED=false
```

## Modelos virtuais

Use estes modelos no campo `model`:

```txt
atlas/auto
atlas/fast
atlas/reasoning
atlas/tools
atlas/compeat
```

Aliases uteis:

```txt
auto
fast
reasoning
tools
compeat
compete
smart
```

### atlas/auto

Escolhe o melhor provider disponivel com base em prioridade, saude, latencia, falhas recentes e score interno.

Bom para uso geral.

### atlas/fast

Prioriza modelos rapidos.

Bom para chat simples, resposta curta, automacoes e ferramentas locais.

### atlas/reasoning

Prioriza modelos com capacidade de raciocinio.

Bom para prompts mais dificeis, analise, planejamento e codigo.

### atlas/tools

Prioriza modelos configurados como bons para uso com tools.

### atlas/compeat

Roda uma competicao entre pelo menos duas IAs disponiveis.

Fluxo:

1. Seleciona providers diferentes.
2. Envia o mesmo prompt para todos em paralelo.
3. Coleta as respostas.
4. Calcula score por heuristica local.
5. Escolhe a resposta vencedora.
6. Retorna a resposta no formato OpenAI.

O score considera:

- tamanho util;
- diversidade lexical;
- estrutura;
- concretude;
- alinhamento com o prompt;
- alinhamento com formato pedido;
- completude;
- sinais suspeitos como `SEARCH` e citacoes falsas;
- latencia;
- confianca operacional do provider.

O `compeat` tambem suporta `stream: true`. Nesse caso ele compete primeiro e depois entrega a resposta vencedora em SSE.

## Exemplos de uso

### Health

```bash
curl http://localhost:3000/health
```

### Providers vivos

```bash
curl http://localhost:3000/v1/providers
```

### Modelos

```bash
curl http://localhost:3000/v1/models
```

### Chat simples

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "atlas/auto",
    "messages": [
      { "role": "user", "content": "Responda apenas ok" }
    ]
  }'
```

### Usar Kimi diretamente

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "k2d6",
    "messages": [
      { "role": "user", "content": "Explique em uma frase o que e uma proxy de IA." }
    ]
  }'
```

### Usar compeat

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "atlas/compeat",
    "messages": [
      { "role": "user", "content": "Explique em 3 bullets o que e fallback de modelos." }
    ]
  }'
```

### Streaming

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "atlas/compeat",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Responda em 3 bullets sobre roteamento de modelos." }
    ]
  }'
```

## Usando em clientes OpenAI-compatible

Configuracao padrao:

```txt
Base URL: http://127.0.0.1:3000/v1
API Key: vazio, dummy, local, atlas ou qualquer valor aceito pelo cliente
Model: atlas/auto
```

Para qualidade maior com competicao:

```txt
Model: atlas/compeat
```

Para latencia menor:

```txt
Model: atlas/fast
```

## Rotas internas

```txt
GET  /health
GET  /v1/models
GET  /v1/providers
GET  /v1/router/models
GET  /v1/router/health
GET  /v1/router/alerts
GET  /v1/router/metrics
GET  /v1/router/compeat
GET  /v1/router/supervisor
POST /v1/chat/completions
```

### /v1/router/alerts

Mostra alertas ativos:

```bash
curl http://localhost:3000/v1/router/alerts
```

Incluir alertas resolvidos:

```bash
curl "http://localhost:3000/v1/router/alerts?include_resolved=true"
```

### /v1/router/metrics

Mostra metricas runtime:

```bash
curl http://localhost:3000/v1/router/metrics
```

Inclui:

- total de requests;
- falhas;
- latencia total;
- requests por modelo;
- status HTTP;
- tentativas por provider.

### /v1/router/compeat

Mostra comparacoes ativas e recentes do `atlas/compeat`:

```bash
curl http://localhost:3000/v1/router/compeat
```

Inclui:

- resposta de cada IA;
- score;
- breakdown do score;
- latencia;
- erro, se houver;
- vencedor.

## Configuracao

Arquivo base:

```txt
.env.example
```

Principais variaveis:

```env
PORT=3000
ATLAS_REQUEST_TIMEOUT_MS=60000
ATLAS_SUPERVISOR_ENABLED=true
ATLAS_SUPERVISOR_HEALTH_INTERVAL_MS=15000
ATLAS_SUPERVISOR_RESTART_BASE_DELAY_MS=2000
```

DeepSeek:

```env
DEEPS_ENABLED=true
DEEPS_BASE_URL=http://127.0.0.1:3101
DEEPS_MAX_CONCURRENT=2
DEEPS_QUEUE_TIMEOUT_MS=45000
DEEPS_TIMEOUT_MS=30000
DEEPS_MAX_RETRIES=0
```

Qwen:

```env
QWEN_ENABLED=true
QWEN_BASE_URL=http://127.0.0.1:3102
QWEN_MAX_CONCURRENT=1
QWEN_QUEUE_TIMEOUT_MS=45000
QWEN_TIMEOUT_MS=30000
QWEN_MAX_RETRIES=0
```

Kimi:

```env
KIMI_ENABLED=true
KIMI_BASE_URL=http://127.0.0.1:3103
KIMI_MAX_CONCURRENT=1
KIMI_QUEUE_TIMEOUT_MS=45000
KIMI_TIMEOUT_MS=30000
KIMI_MAX_RETRIES=0
```

Se uma source nao existir localmente e voce nao configurar um `*_BASE_URL` manual, o provider e ignorado.

### Limites de output

Os campos de metadata como `max_output_tokens` em `src/config/models.ts` sao configuraveis pelo AtlasRouter. Voce pode aumentar, diminuir ou remover esses valores conforme o uso desejado.

Esses valores nao forcam o provider a aceitar qualquer tamanho. Eles servem como informacao exposta pelo router. Se a IA ou a proxy tiver um limite interno menor, o provider ainda pode cortar a resposta, retornar erro ou fechar a conexao quando atingir o proprio limite.

## Persistencia

O Atlas salva estado operacional em:

```txt
.atlasrouter/provider-metrics.json
```

Isso guarda:

- sucesso/falha por provider;
- falhas consecutivas;
- score dinamico;
- ultimo status;
- circuit breaker.

A pasta `.atlasrouter/` fica no `.gitignore`.

## Circuit breaker

Se um provider falha varias vezes seguidas, ele entra temporariamente em circuit breaker.

Enquanto o circuito esta aberto:

- o provider perde score;
- o router evita usa-lo;
- alertas aparecem em `/v1/router/alerts`;
- uma volta saudavel resolve alertas antigos.

Variaveis:

```env
ATLAS_CIRCUIT_FAILURES=3
ATLAS_CIRCUIT_OPEN_MS=60000
```

## Comportamento quando faltam proxies

Exemplo: voce baixou apenas Kimi e Qwen.

O Atlas:

- detecta `sources/kimiproxy`;
- detecta `sources/qwenproxy`;
- nao inclui DeepSeek se `sources/deepsproxy` nao existir;
- nao tenta ligar DeepSeek;
- nao mostra erro grotesco por pasta ausente.

Se voce configurar `DEEPS_BASE_URL` manualmente, o Atlas considera que DeepSeek existe em outro lugar e tenta usar esse endpoint.

## Troubleshooting

### O provider aparece offline

Verifique:

```bash
curl http://localhost:3000/v1/router/supervisor
curl http://localhost:3000/v1/providers
curl http://localhost:3000/v1/router/alerts
```

Se for sessao expirada:

```bash
npm run atlas -- login qwen
```

Troque `qwen` por `deepseek` ou `kimi`.

### Porta ocupada

Verifique quem esta usando a porta:

```bash
lsof -i :3102
```

Ou altere a URL/porta no `.env`.

### Cliente exige API key

Coloque qualquer valor aceito pelo cliente, por exemplo:

```txt
local
atlas
dummy
```

O AtlasRouter nao valida API key propria.

### Quero usar so Kimi

```bash
npm run atlas -- get kimi
npm run atlas -- login kimi
npm run dev
```

Use:

```txt
Model: k2d6
```

Ou:

```txt
Model: atlas/auto
```

Com apenas Kimi instalado, o `atlas/auto` so tera Kimi como candidato.

### Quero usar Kimi e Qwen

```bash
npm run atlas -- get kimi qwen
npm run atlas -- login kimi
npm run atlas -- login qwen
npm run dev
```

Use:

```txt
Model: atlas/auto
```

Ou:

```txt
Model: atlas/compeat
```

`atlas/compeat` precisa de pelo menos duas IAs disponiveis.

## Desenvolvimento

Build:

```bash
npm run build
```

Testes:

```bash
npm test
```

Dev server:

```bash
npm run dev
```

CLI local:

```bash
npm run atlas -- list
```

## Contribuidores

- `pedrofariasx`: autor das proxies baixadas pela CLI.
- `Anthophicous`: AtlasRouter.

## Creditos

Codex: suporte de IA.
