export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }
  const MODEL = 'gemini-2.5-flash';

  // ── PERSONAS DINÂMICAS — RESURRECTION ──
  const MENTOR_RESSURGIDO = 'Você é o Mentor Ressurgido — sério, estoico, focado em disciplina pura e renascimento pessoal. Audite as falhas e sucessos do usuário com firmeza. Cobre disciplina física e mental com respeito mas sem piedade. Respostas DIRETAS, CURTAS e HONESTAS em português do Brasil. Tom de mentor que acredita na capacidade de ressurgir. Sem emojis.';

  const MESTRE_COGNICAO = (topico) =>
    `Você é o Mestre de Cognição — especialista absoluto em ${topico}. O usuário está em sessão profunda de estudos. Sua missão é ensinar de forma magistral, detalhada e interativa. Use Markdown rico (negrito, listas, tabelas, blocos de código) para formatar suas explicações. REGRA DE OURO E OBRIGATÓRIA: Nunca encerre uma explicação sem fazer uma pergunta direta e desafiadora ao usuário sobre o que acabou de ser ensinado. Force-o a raciocinar e interagir. Mantenha o tom de um mentor rigoroso e respeitoso. Responda sempre em português do Brasil.`;

  const ESTRATEGISTA_CAPITAL = 'Você é o Estrategista de Capital — analítico, preciso e focado em construção de patrimônio inteligente. Sua missão é auditar a mentalidade financeira do usuário e ensinar alocação de capital com precisão matemática. Seja direto sobre juros compostos, mostre a diferença de rentabilidade entre opções conservadoras e estratégicas (poupança vs CDB, Tesouro, ativos de maior performance) e incentive aportes consistentes. Use Markdown rico (tabelas comparativas, números em negrito, listas). Tom profissional e estratégico. REGRA OBRIGATÓRIA: Sempre termine desafiando o usuário a investir mais ou cortar um gasto desnecessário. Responda sempre em português do Brasil.';

  const BIOHACKER_ELITE = 'Você é um Biohacker de Elite — especialista em nutrição e controle metabólico, com foco absoluto em DIABETES TIPO 1. O usuário é diabético Tipo 1 (insulinodependente). Sua missão: otimizar controle glicêmico e performance. Foque em CONTAGEM DE CARBOIDRATOS, relação insulina/carbo, índice glicêmico e carga glicêmica com impacto imediato na glicemia. NÃO sugira comportamentos de Diabetes Tipo 2 (como foco em perda de peso para reduzir resistência insulínica, metformina, ou reversão por dieta). Seja tático e técnico sobre glicemia. Se houver imagem, identifique os alimentos, estime calorias, proteínas, gorduras (boas vs ruins) e carboidratos totais, alertando sobre IG e carga glicêmica. Use Markdown rico (tabelas nutricionais, negrito nos números críticos, listas). REGRA OBRIGATÓRIA: Sempre termine desafiando o usuário a melhorar a próxima refeição ou otimizar a relação insulina/carbo. Responda sempre em português do Brasil.';

  // Comando padrão para análise de imagem de alimentos
  const COMANDO_ANALISE_IMAGEM = 'Identifique os alimentos nesta imagem. Estime calorias totais, gramas de proteína, carboidratos totais (com contagem para bolus de insulina), índice glicêmico estimado e gorduras (boas vs ruins). Liste em uma tabela. Dê um veredito focado em Diabetes Tipo 1: impacto glicêmico imediato e sugestão de relação insulina/carbo.';

  try {
    const { prompt, maxTokens, topicoEstudo, historico, moduloAtivo, imagemBase64, tipoDiabetes } = req.body;

    if (!prompt && !imagemBase64) {
      return res.status(400).json({ error: 'Missing prompt or image' });
    }

    // ── SELECIONA PERSONA ──
    let systemInstruction;
    if (moduloAtivo === 'the_fuel') {
      systemInstruction = BIOHACKER_ELITE;
    } else if (moduloAtivo === 'war_chest') {
      systemInstruction = ESTRATEGISTA_CAPITAL;
    } else if (topicoEstudo) {
      systemInstruction = MESTRE_COGNICAO(topicoEstudo);
    } else {
      systemInstruction = MENTOR_RESSURGIDO;
    }

    // ── TOKEN LIMITS ──
    // Nutricionista/Gestor/Professor: 8192 | Sargento: 300
    const tokenLimit = maxTokens || ((topicoEstudo || moduloAtivo === 'war_chest' || moduloAtivo === 'the_fuel') ? 8192 : 300);

    // ── MONTA CONTENTS ──
    let contents;

    if (historico && Array.isArray(historico) && historico.length > 0) {
      // Multi-turn: mapeia histórico anterior para formato Gemini
      contents = historico.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.text }]
      }));

      // Adiciona a pergunta atual como última mensagem
      // Se tem imagem, monta parts multimodal
      if (imagemBase64) {
        const userParts = [
          { inline_data: { mime_type: 'image/jpeg', data: imagemBase64 } },
          { text: prompt || COMANDO_ANALISE_IMAGEM }
        ];
        contents.push({ role: 'user', parts: userParts });
      } else {
        contents.push({ role: 'user', parts: [{ text: prompt }] });
      }

      // Gemini exige que contents comece com role: "user"
      while (contents.length > 0 && contents[0].role === 'model') {
        contents.shift();
      }

      // Gemini exige roles alternados — merge consecutivos do mesmo role
      const merged = [contents[0]];
      for (let i = 1; i < contents.length; i++) {
        const prev = merged[merged.length - 1];
        if (contents[i].role === prev.role) {
          // Merge parts arrays instead of just text (supports multimodal)
          prev.parts = prev.parts.concat(contents[i].parts);
        } else {
          merged.push(contents[i]);
        }
      }
      contents = merged;
    } else if (imagemBase64) {
      // Single-turn com imagem (sem histórico)
      contents = [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imagemBase64 } },
          { text: prompt || COMANDO_ANALISE_IMAGEM }
        ]
      }];
    } else {
      // Single-turn texto simples
      contents = [{ role: 'user', parts: [{ text: prompt }] }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }]
        },
        contents,
        generationConfig: { maxOutputTokens: tokenLimit, temperature: 0.85 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', response.status, JSON.stringify(data));
      return res.status(response.status).json({
        error: data?.error?.message || `Gemini API HTTP ${response.status}`,
        details: data
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    return res.status(200).json({ text });
  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: err.message });
  }
}
