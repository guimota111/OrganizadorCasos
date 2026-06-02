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

> ⚠️ **Restringir antes de ir para produção.** Exemplo com autenticação:
> ```
> allow read, write: if request.auth != null;
> ```

## Funcionalidades

- Cadastro de casos com nome, FAP, resumo clínico e status
- Status: **Encaminhado** (sem pendência) ou **Pendência** (com descrição)
- Contadores em tempo real: total, com pendência, encaminhados, liberados
- Liberar caso (move para o arquivo)
- Editar e excluir casos (com confirmação)
- Sincronização em tempo real via Firestore `onSnapshot`
- Layout responsivo para mobile
