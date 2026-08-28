# Organizador de Casos — Patologia

Site estático hospedado no **GitHub Pages** com Firebase (Firestore) como backend.

## Estrutura

```
/
├── index.html          # Página principal
├── style.css           # Estilos
├── app.js              # Lógica da aplicação (ES module)
└── firebase-config.js  # Inicialização do Firebase
```

## Hospedagem no GitHub Pages

1. Vá em **Settings → Pages** do repositório.
2. Em *Source*, selecione o branch `main` e pasta `/` (root).
3. Salve — o site ficará disponível em `https://<usuario>.github.io/<repo>/`.

> Como o projeto usa ES modules (`type="module"`), o GitHub Pages serve os arquivos corretamente sem nenhuma configuração extra.

## Organizadores

Cada conta pode ter vários organizadores — listas independentes de casos (por
hospital, por rotina, por tipo de material). Os dados ficam em:

```
users/{uid}/organizadores/{orgId}          # { nome, ordem, createdAt }
users/{uid}/organizadores/{orgId}/casos    # os casos daquele organizador
```

- O seletor no cabeçalho troca o organizador ativo; a engrenagem (⚙) abre o
  gerenciador para criar, renomear e excluir.
- Cada organizador tem os próprios contadores, ordem de impressão e ordem da lista.
- O organizador ativo vai para a URL (`?org=<id>`), então dá para deixar **dois
  organizadores abertos ao mesmo tempo em abas diferentes**.
- Um caso pode ser movido de organizador pelo seletor "Mover para…" dentro do caso.
- **Migração automática:** no primeiro acesso depois desta mudança, é criado o
  organizador "Principal" e os casos antigos (`users/{uid}/casos`, ou a antiga
  coleção raiz `casos`) são copiados para dentro dele. Os documentos de origem
  não são apagados — ficam como backup.

## Regras do Firestore (desenvolvimento)

No console do Firebase → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ **Restringir antes de ir para produção.** Cada um só enxerga os próprios
> organizadores:
> ```
> match /users/{uid}/{document=**} {
>   allow read, write: if request.auth != null && request.auth.uid == uid;
> }
> ```

## Funcionalidades

- Cadastro de casos com nome, FAP, resumo clínico e status
- Status: **Encaminhado** (sem pendência) ou **Pendência** (com descrição)
- Contadores em tempo real: total, com pendência, encaminhados, liberados
- Liberar caso (move para o arquivo)
- Editar e excluir casos (com confirmação)
- Sincronização em tempo real via Firestore `onSnapshot`
- Vários organizadores por conta, com troca pelo cabeçalho e caso movível entre eles
- Layout responsivo para mobile
