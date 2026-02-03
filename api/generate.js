const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ==========================================
// 模型映射層 (Research Model -> Real Model)
// 目標：維持前端代號不變，但實際呼叫「真實模型」
// ==========================================
function mapModel(researchModel) {
  const mapping = {
    // 與 experiment_auto1.html 的 value 完全一致
    "gpt-4o": "gpt-4o",
    "gpt-5.2": "gpt-5.2",
    "gpt-4o-mini": "gpt-4o-mini",
    "gpt-5-nano": "gpt-5-nano",
    "o3": "o3",

    // 若你未來 UI 有 thinking 代號，可先這樣對應（不改 UI 也不會用到）
    "gpt-5.2-thinking": "gpt-5.2",
  };

  // 預設回退：避免前端亂傳值導致整個 API 掛掉
  return mapping[researchModel] || "gpt-4o-mini";
}

// 某些模型/設定對 temperature 等參數有嚴格限制
// 為了「不中斷實驗」：只在明確安全的模型上帶 temperature
function buildOptionalParams(realModel, temperature) {
  const t = parseFloat(temperature);
  const hasTemp = Number.isFinite(t);

  // gpt-4o / gpt-4o-mini 一般可用 temperature
  if ((realModel === "gpt-4o" || realModel === "gpt-4o-mini") && hasTemp) {
    return { temperature: t };
  }

  // gpt-5.2：若要用 temperature，建議搭配 reasoning.effort = "none"
  // 這裡我們一律把 gpt-5.2 設成 effort: "none"（更穩）
  if (realModel === "gpt-5.2" && hasTemp) {
    return { temperature: t };
  }

  // gpt-5-nano / o3：保守起見不塞 temperature，避免相容性錯誤
  return {};
}

module.exports = async (req, res) => {
  // 1) CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { prompt, model, strategy, temperature } = req.body;

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Server Error: Missing OPENAI_API_KEY env variable.");
    }

    // 2) 模型映射（現在會映射到「真模型」）
    const realModel = mapModel(model);
    const isProxy = (model !== realModel); // 正常情況應該都是 false

    console.log(`[Lab] Request: ${model} -> Real Model: ${realModel}`);

    // 3) 系統提示詞（保留你原本的實驗邏輯，不動 UI/UX）
    let systemPrompt = "你是一個繁體中文 AI 助理。";

    // (A) 模型特性模擬（你原本的假設仍保留；但現在是真模型在跑）
    if (model === "gpt-5.2") {
      systemPrompt += " 你現在是 GPT-5.2。請展現極高的邏輯性、準確度與安全意識。遇到不確定的事請保守回答。";
    } else if (model === "gpt-5-nano") {
      systemPrompt += " 你現在是 GPT-5 Nano。回答必須非常簡短、快速。";
    } else if (model === "o3") {
      systemPrompt += " 你是推理模型。請以清楚條列方式回答，必要時先列出推理步驟再給結論。";
    }

    // (B) 策略注入
    if (strategy === "persona") {
      systemPrompt += " 你是一位精通繁體中文與台灣文化的學術專家。";
    } else if (strategy === "cot") {
      systemPrompt += " 請一步一步思考 (step by step)，但避免輸出冗長內在獨白，使用條列化推理即可。";
    }

    const startTime = Date.now();

    // 4) 使用 Responses API（官方建議；不影響你的前端）
    // gpt-5.2：固定用 reasoning.effort="none" 以提高參數相容性與穩定性
    const requestBody = {
      model: realModel,
      instructions: systemPrompt,
      input: prompt,
      ...(realModel === "gpt-5.2" ? { reasoning: { effort: "none" } } : {}),
      ...buildOptionalParams(realModel, temperature),
    };

    const response = await openai.responses.create(requestBody);

    const output = response.output_text || "";
    const endTime = Date.now();

    // 5) 回傳（保留你前端/CSV 可能用到的欄位）
    res.status(200).json({
      output,
      latency: endTime - startTime,
      length: output.length,
      model_used: model,
      real_model_used: realModel,
      is_proxy: isProxy,
    });
  } catch (error) {
    console.error("[API Error]", error);
    res.status(500).json({
      error: error.message || "Unknown API Error",
    });
  }
};
