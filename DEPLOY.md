# Guia de produção — Isabel: Será que é Fake?

Este manual publica o frontend na Vercel e mantém a autoridade do jogo em uma VPS Ubuntu/Debian. Nenhuma senha, chave privada ou certificado deve entrar no Git.

## 1. Visão da implantação

- `seraquefake.pedrooreis.me`: SPA React/Vite na Vercel, sem proxy Cloudflare.
- `api.seraquefake.pedrooreis.me`: Cloudflare com proxy ativo → Caddy na VPS → Node em `127.0.0.1:3000`.
- Estado durável: `/var/lib/isabel/isabel.sqlite`, em WAL.
- Backups: `/var/backups/isabel`, um por dia, retenção de sete dias.
- Processo único: Socket.IO + SQLite. Para múltiplos processos, será obrigatório adicionar Redis antes de escalar horizontalmente.

## 2. Preparar a Vercel

1. Importe o repositório como novo projeto e mantenha a raiz do repositório como **Root Directory**. Não selecione somente `client`, pois o build usa os workspaces e o lockfile da raiz.
2. A configuração de build já está em `vercel.json`: instala somente o workspace web, executa o build do Vite e publica `client/dist`. O SQLite e o servidor não são enviados para a Vercel.
3. Em **Settings → Build and Deployment → Node.js Version**, confirme `24.x`. O `package.json` também exige Node 24, mas vale conferir o log do primeiro build.
4. Cadastre a variável no ambiente **Production**:

   ```text
   VITE_API_URL=https://api.seraquefake.pedrooreis.me
   ```

5. Adicione `seraquefake.pedrooreis.me` em **Settings → Domains** e copie o destino DNS exibido pela Vercel.
6. No Cloudflare, crie o CNAME/A solicitado pela Vercel com nuvem cinza (**DNS only**). Não coloque o proxy laranja na frente desse host.
7. Faça um novo deploy depois de salvar a variável. Confirme que `/`, `/superadmin` e uma atualização direta nessas rotas retornam a SPA.

Os valores presentes em `vercel.json` prevalecem sobre overrides conflitantes do painel. A reescrita para `index.html` é a configuração oficial para deep links de uma SPA Vite. Previews da Vercel não terão acesso ao servidor por padrão: para testar um preview contra a API, inclua **a origem exata** daquele preview em `CLIENT_ORIGINS`, separada por vírgula, e reinicie a API. Não use `*` com cookies administrativos.

## 3. DNS e TLS da API no Cloudflare

1. Crie um registro `A` chamado `api` apontando para o IPv4 público da VPS, com proxy laranja ativo.
2. Em **SSL/TLS**, escolha **Full (strict)**.
3. Em **Origin Server**, gere um certificado Origin CA que cubra `api.seraquefake.pedrooreis.me`.
4. Na VPS, grave certificado e chave fora do projeto:

   ```bash
   sudo install -d -m 750 -o root -g caddy /etc/ssl/cloudflare
   sudoedit /etc/ssl/cloudflare/seraquefake-origin.pem
   sudoedit /etc/ssl/cloudflare/seraquefake-origin.key
   sudo chown root:caddy /etc/ssl/cloudflare/seraquefake-origin.*
   sudo chmod 640 /etc/ssl/cloudflare/seraquefake-origin.*
   ```

5. Em **Network**, confirme **WebSockets: On**. O plano gratuito suporta WebSockets, mas uma atualização da rede Cloudflare pode derrubar uma conexão; o cliente já reconecta e reassume a sala.
6. Em **SSL/TLS → Edge Certificates**, ative **Always Use HTTPS**. Este manual expõe somente a porta 443 da origem; sem esse redirecionamento no edge, acessos iniciados em HTTP podem falhar.
7. Em **Cache Rules**, crie uma regra para o host `api.seraquefake.pedrooreis.me` com **Cache eligibility: Bypass cache**. Assim `/api/*`, o polling e o handshake `/socket.io/*` nunca herdam uma futura regra “cache everything”.

O Origin CA é apropriado porque o host `api` permanece com proxy laranja. Um acesso direto ao IP não terá certificado confiável no navegador — isso é esperado e desejável nesta arquitetura.

## 4. Preparar a VPS

Atualize a máquina e instale os utilitários básicos:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git gpg sqlite3 ufw build-essential python3 debian-keyring debian-archive-keyring apt-transport-https
```

Instale o pacote estável oficial do Caddy para Debian/Ubuntu:

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Instale Node.js 24 LTS pelo repositório NodeSource depois de revisar o script baixado:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

Interrompa a instalação se `node --version` não começar por `v24.`.

Crie o usuário sem privilégios e os diretórios:

```bash
sudo adduser --system --group --home /var/lib/isabel isabel
sudo install -d -m 750 -o isabel -g isabel /var/lib/isabel /var/backups/isabel
sudo install -d -m 755 -o "$USER" -g "$USER" /opt/isabel/releases
sudo install -d -m 750 -o root -g isabel /etc/isabel
sudo install -d -m 750 -o caddy -g caddy /var/log/caddy
```

Firewall mínimo; a porta 3000 nunca deve ficar pública. Libere o SSH antes de ativar o UFW para não perder o acesso:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
```

Restrinja a porta 443 aos intervalos oficiais da Cloudflare. Isso é obrigatório nesta configuração porque o Caddy confia no cabeçalho `CF-Connecting-IP` para preservar o IP real no rate limit. Consulte sempre as listas atuais antes de executar:

```bash
curl -fsS https://www.cloudflare.com/ips-v4 -o /tmp/cloudflare-ips-v4
curl -fsS https://www.cloudflare.com/ips-v6 -o /tmp/cloudflare-ips-v6
while IFS= read -r cidr; do sudo ufw allow proto tcp from "$cidr" to any port 443; done < /tmp/cloudflare-ips-v4
while IFS= read -r cidr; do sudo ufw allow proto tcp from "$cidr" to any port 443; done < /tmp/cloudflare-ips-v6
sudo ufw status numbered
```

A Cloudflare publica alterações antes de usar novas faixas; revise `https://www.cloudflare.com/ips/` periodicamente e reaplique a lista quando ela mudar. Restrinja também o SSH ao seu IP sempre que houver endereço fixo. O certificado Origin CA não substitui a regra de firewall: ele criptografa o enlace, mas não impede sozinho acesso direto ao IP da origem. Se **Always Use HTTPS** não puder ser ativado para toda a zona, libere também a porta 80 apenas para os intervalos Cloudflare e deixe o Caddy redirecionar; não abra 80 para a internet inteira.

## 5. Instalar uma release

Cada atualização ocupa uma pasta própria. Substitua a origem do repositório e o identificador da release:

```bash
release_id="$(date -u +%Y%m%d%H%M%S)"
git clone --depth 1 URL_DO_REPOSITORIO "/opt/isabel/releases/$release_id"
cd "/opt/isabel/releases/$release_id"
npm ci --omit=dev --workspace @isabel/server --workspace @isabel/shared
sudo chown -R root:isabel "/opt/isabel/releases/$release_id"
sudo chmod -R u=rwX,g=rX,o= "/opt/isabel/releases/$release_id"
sudo ln -sfn "/opt/isabel/releases/$release_id" /opt/isabel/current
```

O SQLite é criado automaticamente na primeira inicialização e recebe os 100 fatos ativos, todos marcados como pendentes de auditoria.

## 6. Configurar a senha e o ambiente

Gere o hash Argon2id sem deixar a senha no histórico:

```bash
cd /opt/isabel/current
read -rsp "Senha do superadmin: " ISABEL_ADMIN_PASSWORD; echo
ADMIN_PLAIN="$ISABEL_ADMIN_PASSWORD" node -e 'import("argon2").then(async ({default:a}) => console.log(await a.hash(process.env.ADMIN_PLAIN,{type:a.argon2id})))'
unset ISABEL_ADMIN_PASSWORD
```

Copie `deploy/isabel.env.example` para `/etc/isabel/isabel.env`, substitua o hash completo e proteja o arquivo:

```bash
sudo cp deploy/isabel.env.example /etc/isabel/isabel.env
sudoedit /etc/isabel/isabel.env
sudo chown root:isabel /etc/isabel/isabel.env
sudo chmod 640 /etc/isabel/isabel.env
```

Não use aspas no hash do arquivo `EnvironmentFile`. O caractere `$` é aceito literalmente pelo systemd nesse formato.

## 7. Ativar Caddy, API e backup

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo cp deploy/isabel.service /etc/systemd/system/isabel.service
sudo cp deploy/isabel-backup.service /etc/systemd/system/isabel-backup.service
sudo cp deploy/isabel-backup.timer /etc/systemd/system/isabel-backup.timer
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemd-analyze verify /etc/systemd/system/isabel.service /etc/systemd/system/isabel-backup.service /etc/systemd/system/isabel-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now caddy isabel.service isabel-backup.timer
sudo systemctl reload caddy
```

Valide a configuração antes de considerar o imóvel entregue:

```bash
systemctl status --no-pager isabel caddy isabel-backup.timer
curl --fail http://127.0.0.1:3000/api/healthz
bash deploy/scripts/smoke-test.sh
```

## 8. Logs e operação

- API: `journalctl -u isabel -f`.
- Caddy: `/var/log/caddy/isabel-api.log` e `journalctl -u caddy`.
- Backup manual: `sudo systemctl start isabel-backup.service`.
- Lista dos timers: `systemctl list-timers isabel-backup.timer`.
- Estado da sala é salvo após voto, alimentação e mudança de fase. Ao reiniciar, prazos vencidos são recalculados.
- Relatórios permanecem até a revanche e são apagados do servidor depois de 30 minutos com a sala vazia; o último relatório pessoal permanece no navegador do jogador.

Teste restauração antes de depender do backup. O procedimento abaixo valida o SHA-256, preserva uma cópia emergencial do banco atual e só então promove o arquivo restaurado:

```bash
backup_file=/var/backups/isabel/ARQUIVO.sqlite3
(cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$backup_file").sha256")
sudo systemctl stop isabel
sudo cp -a /var/lib/isabel/isabel.sqlite "/var/backups/isabel/pre-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite3"
sudo -u isabel sqlite3 "$backup_file" ".backup '/var/lib/isabel/isabel-restaurado.sqlite'"
sudo -u isabel sqlite3 /var/lib/isabel/isabel-restaurado.sqlite 'PRAGMA integrity_check;' | grep -qx ok
sudo rm -f /var/lib/isabel/isabel.sqlite-wal /var/lib/isabel/isabel.sqlite-shm
sudo -u isabel mv /var/lib/isabel/isabel-restaurado.sqlite /var/lib/isabel/isabel.sqlite
sudo systemctl start isabel
curl --fail https://api.seraquefake.pedrooreis.me/api/healthz
```

## 9. Atualização e rollback

Antes de atualizar, rode `npm test` e `npm run build` no CI ou em uma máquina com Node 24. Na VPS, instale uma nova release como na seção 5, faça o link atômico e reinicie:

```bash
sudo systemctl restart isabel
bash /opt/isabel/current/deploy/scripts/smoke-test.sh
```

Se o smoke test falhar, aponte `/opt/isabel/current` para a release anterior e reinicie. Não apague releases antigas até confirmar a nova versão e um backup válido:

```bash
sudo ln -sfn /opt/isabel/releases/ID_ANTERIOR /opt/isabel/current
sudo systemctl restart isabel
```

Mudanças futuras de schema devem vir acompanhadas de migração reversível ou backup obrigatório. O catálogo também pode ser exportado em JSON pelo superadmin antes de cada atualização.

O frontend tem rollback independente: em **Vercel → Deployments**, abra o último deployment conhecido como estável e use **Promote to Production**. Depois valide `/` e `/superadmin`; reverter apenas a SPA não altera o SQLite.

## 10. Checklist de aceite em produção

- HTTPS da SPA e `/superadmin` sem conteúdo misto.
- `GET /api/healthz` retorna `ok: true` e `seededFacts: 100`.
- WSS conecta através da Cloudflare e reconecta após troca de rede.
- Duas abas completam os modos Clássico e Fatos da Galera sem revelar placar durante as rodadas.
- O 9º participante é recusado e quem entra no meio aguarda a revanche.
- Host migra após 30 segundos; assento é reservado por 60 segundos.
- Superadmin exige senha, cookie seguro e CSRF; importação simulada mostra erros por linha.
- Backup diário é criado, validado pelo SHA-256 e removido após sete dias.
- Restauração e rollback foram praticados pelo menos uma vez.

## 11. Credenciais que ainda serão necessárias

Para efetivar a publicação, o operador precisa autorizar acesso ao projeto Vercel, à zona DNS/SSL na Cloudflare e ao SSH da VPS. Não cole essas credenciais em arquivos do projeto; prefira sessões autenticadas, chaves SSH e variáveis secretas das plataformas.

## 12. Referências oficiais conferidas

- [Vite como SPA na Vercel](https://vercel.com/docs/frameworks/frontend/vite) e [configuração de build](https://vercel.com/docs/builds/configure-a-build).
- [Node.js 24 na Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/), [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/) e [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/).
- [WebSockets na Cloudflare](https://developers.cloudflare.com/network/websockets/) e [Cache Rules com bypass](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/).
- [Reverse proxy e WebSockets no Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
