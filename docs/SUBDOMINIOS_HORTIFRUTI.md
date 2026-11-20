# CR Jornada Hortifruti — três acessos, um sistema existente

**Escopo somente CR_JORNADA_ORTIFRUTI.**
Não conectar ao Super Admin geral `admin.crjornada.com`, ao Worker de postos ou
ao banco da farmácia. O PR de integração do Pelicano foi encerrado sem merge.

## Endereços pretendidos

- `https://hortifruti-admin.crjornada.com/` encaminha para `/superadmin` do
  próprio Hortifruti (exige login de superadmin já existente neste sistema).
- `https://hortifruti.crjornada.com/admin` é o login de todos os proprietários
  do Hortifruti, usando e-mail e senha. Cada login mantém o próprio tenant.
- `https://{slug}.crjornada.com/` é a vitrine do estabelecimento, com branding,
  categorias, produtos e pedidos existentes. Ex.: `verdurao.crjornada.com`.

Rotas antigas `/superadmin`, `/admin` e `/loja/:slug` permanecem, para
não invalidar links já compartilhados. O cadastro atual de loja chama
`POST /api/superadmin/tenants`, grava senha com hash e retorna a senha inicial
só uma vez. O painel mostra controles para copiá-la, juntamente com e-mail,
link de administração e link da vitrine. O proprietário pode mudar a senha
quando quiser, sem necessidade de redefinição ao primeiro login.

## Cloudflare — etapa externa obrigatória antes de distribuir novos links

**Não alterar registros ou Workers dos outros projetos sem auditar os DNS e
rotas ativos.** Primeiro tire uma cópia dos registros da zona `crjornada.com`.
Depois configure os dois hosts administrativos para o Worker
`cr-jornada-hortifruti` e confirme HTTPS/TLS.

Para vitrines automáticas, avaliar *uma única configuração* de DNS wildcard
`*.crjornada.com` + Worker Route para o Hortifruti: isso dispensa criar um
novo registro DNS por estabelecimento, porque cada hostname será resolvido pelo
slug no aplicativo. **Entretanto, uma Worker Route wildcard mal aplicada
poderia capturar tráfego dos outros produtos.** Só habilitar depois de listar
as rotas específicas e garantir prioridade/exclusões de
`admin`, `pontos`, `fidelidade`, `evolution`, etc. Nunca fazer migração
sem backup/rollback. A opção alternativa é registrar a rota e o DNS de cada
loja separadamente.

DNS/rotas não são criados automaticamente pelo código desta PR. Antes de
compartilhar um novo subdomínio, validar propagação, certificado e
`GET /api/store/{slug}` (somente leitura) para esse estabelecimento.

## Testes de aceitação

1. Super Admin Hortifruti abre no domínio exclusivo e cadastra loja.
2. Copiar e-mail, senha e links da tela de exibição única.
3. Login do proprietário no domínio administrativo com a senha inicial.
4. Vitrine de uma loja exibe apenas produtos dessa loja.
5. A mesma loja abre pela rota antiga `/loja/:slug`.
6. Subdomínios `admin.crjornada.com`, `pontos.crjornada.com` e demais serviços
   não são apontados ao Worker Hortifruti nem alterados.
