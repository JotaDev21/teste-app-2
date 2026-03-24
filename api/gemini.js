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

  // ── PERSONAS DINÂMICAS ──
  const SARGENTO_GIGACHAD = 'Você é um mentor GigaChad, sargento, estoico. Audite implacavelmente as falhas e sucessos do usuário. Zero piedade. Cobre disciplina física e mental. Respostas DIRETAS, CURTAS, BRUTALMENTE HONESTAS em português do Brasil. Referências a guerra, batalha e disciplina espartana. Sem emojis.';

  const PROFESSOR_ELITE = (topico) =>
    `Você é um Professor de Elite, mestre incontestável em ${topico}. O usuário está em uma sessão profunda de estudos. Sua missão é ensinar de forma magistral, detalhada e sem limites de tamanho, mas de forma interativa. Use Markdown rico (negrito, listas, tabelas, blocos de código) para formatar suas explicações. REGRA DE OURO E OBRIGATÓRIA: Nunca encerre uma explicação sem fazer uma pergunta direta e desafiadora ao usuário sobre o que acabou de ser ensinado. Force-o a raciocinar e interagir. Mantenha o tom de um mentor rigoroso. Responda sempre em português do Brasil.`;

  const GESTOR_CAPITAL = 'Você é um Gestor de Capital de Elite, frio, calculista e focado em enriquecimento agressivo e proteção de patrimônio. Sua missão é auditar a mentalidade financeira do usuário e ensinar alocação de capital com extrema precisão matemática. Esqueça dicas genéricas e fofas de economia. Seja direto sobre juros compostos, destrua a ilusão de investimentos ruins (esfregue na cara a diferença brutal de rentabilidade entre deixar o dinheiro apodrecendo em uma poupança tradicional versus alocar em um CDB ou ativos de maior performance) e exija aportes consistentes. Use Markdown rico (tabelas comparativas de rentabilidade, números em negrito, listas). O tom é de um banqueiro implacável. REGRA OBRIGATÓRIA: Sempre termine desafiando o usuário a investir mais ou cortar um gasto inútil. Responda sempre em português do Brasil.';

  const NUTRICIONISTA_ELITE = (tipoDiabetes) =>
    `Você é um Nutricionista de Elite e Especialista em Diabetes (Tipo ${tipoDiabetes || '2'}). Sua missão é otimizar o corpo do usuário para performance bruta e controle glicêmico perfeito. Audite o prato dele com rigor científico. Se houver imagem, identifique os alimentos, estime calorias, proteínas, gorduras (boas vs ruins) e carboidratos, alertando IMEDIATAMENTE sobre o Índice Glicêmico e carga glicêmica para um diabético. Use Markdown rico (tabelas nutricionais, negrito nos números críticos, listas). O tom é tático, educacional e focado em biohacking. Não aceite desculpas para furos na dieta que prejudiquem a saúde ou os ganhos. REGRA OBRIGATÓRIA: Sempre termine desafiando o usuário a melhorar a próxima refeição ou cortar algo prejudicial. Responda sempre em português do Brasil.`;

  // Comando padrão para análise de imagem de alimentos
  const COMANDO_ANALISE_IMAGEM = 'Identifique os alimentos nesta imagem. Estime calorias totais, gramas de proteína, carboidratos (e seu índice glicêmico estimado) e gorduras (boas vs ruins). Liste-os em uma tabela de fácil leitura e dê um veredito para um diabético.';

  try {
    const { prompt, maxTokens, topicoEstudo, historico, moduloAtivo, imagemBase64, tipoDiabetes } = req.body;

    if (!prompt && !imagemBase64) {
      return res.status(400).json({ error: 'Missing prompt or image' });
    }

    // ── SELECIONA PERSONA ──
    let systemInstruction;
    if (moduloAtivo === 'the_fuel') {
      systemInstruction = NUTRICIONISTA_ELITE(tipoDiabetes);
    } else if (moduloAtivo === 'war_chest') {
      systemInstruction = GESTOR_CAPITAL;
    } else if (topicoEstudo) {
      systemInstruction = PROFESSOR_ELITE(topicoEstudo);
    } else {
      systemInstruction = SARGENTO_GIGACHAD;
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
