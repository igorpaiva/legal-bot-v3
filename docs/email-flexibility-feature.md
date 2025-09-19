# Funcionalidade de Flexibilidade de Email

## Visão Geral
O bot agora detecta inteligentemente quando clientes não têm ou não desejam fornecer email, permitindo continuar a conversa sem esse campo obrigatório.

## Como Funciona

### 1. Detecção Automática
O bot detecta frases que indicam relutância em fornecer email:

#### Não tem email:
- "não tenho email"
- "não possuo e-mail" 
- "sem email"
- "não uso email"

#### Não quer fornecer:
- "não quero dar meu email"
- "prefiro não fornecer email"
- "não gosto de passar email"

#### Questionamentos:
- "precisa mesmo do email?"
- "é obrigatório o email?"
- "posso continuar sem email?"

#### Respostas evasivas:
- "depois eu passo o email"
- "mais tarde falo o email"
- "vou pensar no email"

#### Problemas técnicos:
- "não tenho acesso ao email"
- "esqueci meu email"
- "não lembro meu email"

### 2. Resposta Inteligente
Quando detecta relutância, o bot:
1. Demonstra compreensão da situação
2. Confirma que pode continuar sem email
3. Faz transição natural para discussão do caso
4. Marca o cliente como `email: 'DECLINED'`
5. **PARA de perguntar sobre email definitivamente**

### 3. Sistema Anti-Insistência
- **Detecção Direta**: Se detecta frases de relutância, para imediatamente
- **Limite de Tentativas**: Máximo 2 tentativas, depois assume relutância
- **Contador de Tentativas**: Rastreia tentativas por conversa
- **Limpeza Automática**: Reseta contador quando email é fornecido ou recusado

### 3. Fluxo Flexível
- Cliente com email válido: fluxo normal
- Cliente que recusa email: pula coleta e vai direto ao caso
- Cliente retornando: verifica se tem email OU se já recusou

## Exemplos de Conversas

### Exemplo 1: Cliente não tem email
```
Bot: Olá João! Para atualizações do caso, qual seu email? (opcional - podemos continuar sem se preferir)
Cliente: não tenho email
Bot: Entendo perfeitamente, João. Podemos continuar sem problema. Agora me conte sobre sua situação jurídica...
```

### Exemplo 2: Cliente questiona necessidade
```
Bot: Qual seu email para contato?
Cliente: é obrigatório o email?
Bot: Não é obrigatório, João. O email apenas ajuda para enviar atualizações, mas podemos prosseguir sem. Conte-me sobre seu caso...
```

### Exemplo 3: Cliente com problemas técnicos
```
Bot: Preciso do seu email...
Cliente: esqueci meu email
Bot: Sem problemas! Vamos continuar sem o email. Me conte os detalhes da sua situação jurídica...
```

### Exemplo 4: Cliente insiste em não fornecer
```
Bot: Qual seu email para contato?
Cliente: xyz123
Bot: Sim, pode ser seu email pessoal ou profissional. Se não tiver email, podemos continuar sem. Qual prefere?
Cliente: não tenho mesmo
Bot: Entendo perfeitamente! Vamos continuar sem problema. Agora me conte sobre sua situação jurídica...
```

### Exemplo 5: Limite de tentativas
```
Bot: Qual seu email?
Cliente: aaa
Bot: Entendo que pode ter dificuldades com email. Se não tiver, podemos continuar sem. Qual prefere?
Cliente: bbb
Bot: Perfeito! Vamos prosseguir sem o email então. Me conte os detalhes do seu caso...
```

## Implementação Técnica

### Função de Detecção
```javascript
detectEmailReluctance(text) {
  // Detecta padrões de relutância em fornecer email
  // Normaliza texto removendo acentos
  // Usa regex para identificar frases comuns
}
```

### Função de Validação
```javascript
hasValidEmailOrDeclined(client) {
  // Verifica se cliente tem email válido OU optou por não fornecer
  // Permite continuar fluxo em ambos os casos
}
```

### Estados do Email
- `null`: Não fornecido ainda
- `email@exemplo.com`: Email válido fornecido  
- `'DECLINED'`: Cliente optou por não fornecer

## Benefícios

1. **Experiência Melhorada**: Clientes não ficam presos na coleta de email
2. **Inclusão**: Acomoda clientes sem email ou com dificuldades técnicas
3. **Naturalidade**: Fluxo mais humano e compreensivo
4. **Flexibilidade**: Adapta-se às necessidades individuais
5. **Conversão**: Não perde clientes por obrigatoriedade de email

## Log de Debug
O sistema registra quando detecta relutância:
```
[DEBUG] handleEmailCollection - Client indicates email reluctance, continuing without email
```

## Casos de Uso
- Clientes idosos que não usam email
- Pessoas com dificuldades técnicas
- Clientes que valorizam privacidade
- Situações urgentes onde email não é prioridade
- Usuários que preferem comunicação apenas por WhatsApp
