# CRSC Parecer RSC-PCCTAE (UFFS)

Ferramenta auxiliar para as Comissões de Reconhecimento de Saberes e Competências (CRSC-PCCTAE) da UFFS.

## O que faz

1. Lê o **PDF do Requerimento** gerado pela [calculadora RSC](https://calculadora-rsc.uffs.edu.br/)
2. Monta **checklist** de critérios (comprovado / não / pendente)
3. Recalcula pontuação e hipóteses de indeferimento (Decreto 13.048/2026)
4. Emite **parecer em PDF** (modelo ANEXO)
5. Seleciona **assinantes** conforme campus/Reitoria (portarias 4696–4721)

## Uso (GitHub Pages)

Abra o site → preencha processo SIPAC e unidade da CRSC → envie o PDF → marque o checklist → gere o parecer.

## Base normativa

- Decreto nº 13.048/2026  
- IN PROGESP nº 9/UFFS/2026  
- Portaria nº 4725/GR/UFFS/2026 (Regimento)  
- Portarias de instituição/designação das CRSC por campus e Reitoria  

## Privacidade

Processamento **local no navegador**. Nenhum dado é enviado a servidor da aplicação.

## Desenvolvimento

Site estático. Sirva a pasta com qualquer servidor HTTP:

```bash
python -m http.server 8080
```

Abra `http://127.0.0.1:8080/`.
